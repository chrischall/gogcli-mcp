/**
 * gog_trip_map — a trip's stops as PINS ON A MAP (never a route): resolve each
 * stop through the Places cache/budget, warn about closed businesses, stops not
 * open at the planned time, ambiguous matches and unresolved stops, build a
 * KML (for My Maps import — My Maps has no API) and a CSV, write both under
 * GOG_FILE_ROOTS, then upload them to Drive "Trips/<title>" and, only when the
 * caller passes confirm_share AND the user confirms on the dispatch rail, share
 * that folder as reader with the listed emails. Never public, never a link.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { isInputRequiredResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { pruneUndefined, resolveView } from '@chrischall/mcp-utils';
import {
  accountParam,
  CONFIRM_FALLBACK_DESCRIPTION,
  confinePath,
  confirmTokenParam,
  fileRoots,
  readonlyEnvEnabled,
  requireDispatchConfirmation,
  resultText,
} from '../../../gogcli-mcp/src/lib.js';
import { API_BUDGET_DEFAULT, ApiBudget } from '../budget.js';
import { evaluateOpenAt } from '../open-at.js';
import { PlacesClient } from '../places-client.js';
import { resolveItems, statusWarnings, type ResolveItem } from '../places-service.js';
import { buildCsv, buildKml, dayLabel, normalizeStops, pinUrl, type TripMapStop } from '../trip.js';
import {
  CSV_MIME,
  findOrCreateFolder,
  KML_MIME,
  listFolderFiles,
  shareFolderWith,
  slugify,
  uploadOrReplace,
  type DriveOps,
} from '../trip-drive.js';
import {
  apiBudgetParam,
  defaultCache,
  failure,
  fieldsParam,
  placesResult,
  projectResolved,
  viewOpt,
  VIEWS,
  type PlacesToolDeps,
} from './places.js';

export type TripToolDeps = PlacesToolDeps;

const TRIPS_FOLDER = 'Trips';

const stopSchema = z.object({
  day: z.union([z.string(), z.number().int()]).describe('ISO date (YYYY-MM-DD) or a day number from 1 (dated by start_date)'),
  time: z.string().optional().describe('Planned local time, 24-hour H:MM or HH:MM'),
  name: z.string().trim().min(1).describe('Place name, e.g. "Armature Works"'),
  address: z.string().optional().describe('Address or city to disambiguate, e.g. "Tampa, FL"'),
  place_id: z.string().optional().describe('A known Google place id (skips the search)'),
  note: z.string().optional().describe('Free text shown on the pin'),
  category: z.string().optional().describe('lodging, food, drinks, sight, activity, event, transport or shopping (pin colour)'),
});

/** The token fallback's preview (phase 1, or a refused token with a fresh one): goes back as-is. */
function isTokenPreview(body: { status?: unknown; confirmToken?: unknown }): boolean {
  return body.status === 'confirmation-required' || body.confirmToken !== undefined;
}

function importSteps(title: string, kmlName: string, folderPath: string | undefined, kmlPath: string): string[] {
  return [
    '1. Open https://www.google.com/maps/d/ and click "Create a new map".',
    folderPath
      ? `2. In "Untitled layer" click "Import", choose "Google Drive", pick ${kmlName} in ${folderPath}.`
      : `2. In "Untitled layer" click "Import", choose "Upload", pick ${kmlName} (at ${kmlPath}).`,
    `3. Name the map ${title}; Share → add the same people (My Maps sharing is separate from the folder's).`,
  ];
}

export function tripTools(deps: TripToolDeps = {}): (server: McpServer) => void {
  const cacheOf = deps.cache ?? defaultCache;

  return (server: McpServer) => {
    server.registerTool('gog_trip_map', {
      description:
        'Turn a trip itinerary into PINS ON A MAP (not a route): resolves each stop to a Google place (cached; '
        + '`api_budget` caps billable Places requests), warns first about closed businesses, stops not open at the '
        + 'planned day+time, ambiguous matches and unresolved stops, and returns each stop\'s Google Maps pin link '
        + 'grouped by day. Writes a KML (one folder per day, one colour per category) and a CSV, uploads both to '
        + 'Drive "Trips/<title>" (reused on re-runs; same-named files replaced), and gives the 3 steps to import the '
        + 'KML into Google My Maps (My Maps and Maps Lists have no API). With share_with + confirm_share: true, '
        + 'shares the folder as reader with those emails only, after the user confirms; never public. '
        + 'GOG_READONLY or upload: false → nothing goes to Drive; the files are returned inline.'
        + CONFIRM_FALLBACK_DESCRIPTION,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      inputSchema: z.object({
        title: z.string().trim().min(1).max(200).describe('Trip title: the map, folder and file name'),
        start_date: z.string().optional().describe('YYYY-MM-DD of day 1, so numbered days get dates (and open-at checks)'),
        stops: z.array(stopSchema).min(1).max(100).describe('The stops (1-100), in any order'),
        share_with: z.array(z.email()).max(50).optional().describe('Emails to share the Drive folder with as reader'),
        confirm_share: z.boolean().optional().describe('Must be true for share_with to be acted on'),
        upload: z.boolean().optional().describe('Upload to Drive (default true); false keeps the files local/inline'),
        drive_parent: z.string().optional().describe('Drive folder id to hold "Trips" (default: My Drive root)'),
        fields: fieldsParam('full'),
        view: viewOpt,
        api_budget: apiBudgetParam,
        account: accountParam,
        confirmToken: confirmTokenParam,
      }),
    }, async (args, ctx) => {
      const { title, start_date, stops, share_with, confirm_share, upload = true, drive_parent, fields = 'full', view, api_budget, account, confirmToken } = args;
      let normalized: ReturnType<typeof normalizeStops>;
      try {
        normalized = normalizeStops(stops, start_date);
      } catch (err) {
        return failure(err);
      }
      const notes = [...normalized.notes];
      const folderPath = `${TRIPS_FOLDER}/${title}`;
      const readonly = readonlyEnvEnabled();
      const driveSkipReason = readonly
        ? 'GOG_READONLY is set: nothing was written to Drive'
        : !upload ? 'upload: false: nothing was written to Drive' : undefined;

      // The share gate runs FIRST, before any Places request or write: a prompt
      // round (or the token fallback's phase 1) re-runs the whole call, and it
      // must not have spent or written anything by then.
      const emails = [...new Set((share_with ?? []).map((e) => e.trim().toLowerCase()))];
      let share: Record<string, unknown> | undefined;
      let shareApproved = false;
      if (emails.length > 0) {
        if (driveSkipReason) {
          share = { shared: false, reason: `${driveSkipReason}, so nothing was shared.` };
        } else if (!confirm_share) {
          share = {
            shared: false,
            reason: 'share_with was given without confirm_share: true, so the folder was not shared. '
              + 'Call again with confirm_share: true to share it (the user is asked first).',
          };
        } else {
          const grant = { folder: folderPath, ...(drive_parent ? { parent: drive_parent } : {}), emails, role: 'reader' };
          const { confirmToken: _token, ...rest } = args;
          const confirmation = await requireDispatchConfirmation(ctx, {
            action: 'drive.share',
            message: 'Review and confirm sharing this trip folder:',
            confirmationLabel: 'Confirm that these people should get read access to the folder now.',
            details: grant,
            unsupportedNote: 'Ask the user to share the folder themselves from Google Drive.',
            fallback: {
              args: rest,
              tool: 'gog_trip_map',
              account,
              confirmToken,
              subject: () => ({ target: folderPath, payload: grant, preview: grant }),
            },
          });
          if (confirmation === undefined) {
            shareApproved = true;
          } else {
            // A prompt round re-runs the whole call once answered.
            if (isInputRequiredResult(confirmation)) return confirmation;
            const body = JSON.parse(resultText(confirmation)) as Record<string, unknown>;
            if (isTokenPreview(body)) return confirmation;
            share = { shared: false, reason: 'Sharing was not confirmed.', confirmation: body };
          }
        }
      }

      const cache = cacheOf();
      const budget = new ApiBudget(api_budget ?? API_BUDGET_DEFAULT);
      const client = new PlacesClient({
        fetch: deps.fetch, env: deps.env, spawner: deps.spawner, readGogConfig: deps.readGogConfig, budget,
      });
      const items = normalized.stops.map((s): ResolveItem => pruneUndefined({ name: s.name, address: s.address, placeId: s.placeId }) as ResolveItem);
      const resolved = await resolveItems(items, { client, cache, fields });
      await cache.save();

      // Stops with their places and warnings, loudest first.
      const mapStops: TripMapStop[] = [];
      const stopWarnings: string[][] = [];
      normalized.stops.forEach((stop, i) => {
        const r = resolved[i]!;
        const warnings = [...r.warnings];
        const place = r.place;
        if (place && stop.date && stop.time && statusWarnings(place).length === 0) {
          const openAt = evaluateOpenAt(place, { date: stop.date, time: stop.time });
          if (openAt.open === false) warnings.push(`Not open at ${stop.date} ${stop.time}: ${stop.name} (${openAt.reason})`);
        }
        stopWarnings.push(warnings);
        mapStops.push(place
          ? {
            ...stop,
            place: {
              placeId: place.id,
              lat: place.location?.latitude,
              lng: place.location?.longitude,
              formattedAddress: place.formattedAddress,
              googleMapsUri: place.googleMapsUri,
              websiteUri: place.websiteUri,
              phone: place.nationalPhoneNumber ?? place.internationalPhoneNumber,
            },
          }
          : stop);
      });
      const warnings = stopWarnings.flat();

      const trip = { title, stops: mapStops };
      const { kml } = buildKml(trip);
      const csv = buildCsv(trip);
      const slug = slugify(title);
      const kmlName = `${slug}.kml`;
      const csvName = `${slug}.csv`;

      let kmlPath: string;
      let csvPath: string;
      try {
        const base = join(fileRoots()[0]!, 'trips');
        await mkdir(base, { recursive: true, mode: 0o700 });
        const dir = confinePath(await mkdtemp(join(base, `${slug}-`)), 'trip directory');
        kmlPath = join(dir, kmlName);
        csvPath = join(dir, csvName);
        await writeFile(kmlPath, kml, 'utf8');
        await writeFile(csvPath, csv, 'utf8');
      } catch (err) {
        return failure(err);
      }

      const files: Record<string, Record<string, unknown>> = {
        kml: { name: kmlName, path: kmlPath },
        csv: { name: csvName, path: csvPath },
      };
      let drive: Record<string, unknown> | undefined;
      let folder: Record<string, unknown> | undefined;
      if (driveSkipReason) {
        drive = { skipped: true, reason: `${driveSkipReason}.` };
      } else {
        const ops: DriveOps = { account, spawner: deps.spawner };
        const sharedWith: string[] = [];
        try {
          const trips = await findOrCreateFolder(TRIPS_FOLDER, drive_parent, ops);
          const made = await findOrCreateFolder(title, trips.folder.id, ops);
          const existing = await listFolderFiles(made.folder.id, ops);
          const kmlUp = await uploadOrReplace(kmlPath, kmlName, KML_MIME, made.folder.id, existing, ops);
          const csvUp = await uploadOrReplace(csvPath, csvName, CSV_MIME, made.folder.id, existing, ops);
          folder = { id: made.folder.id, path: folderPath, link: made.folder.webViewLink, created: made.created };
          Object.assign(files.kml!, { driveId: kmlUp.file.id, driveLink: kmlUp.file.webViewLink, replaced: kmlUp.replaced });
          Object.assign(files.csv!, { driveId: csvUp.file.id, driveLink: csvUp.file.webViewLink, replaced: csvUp.replaced });
          if (shareApproved) {
            for (const email of emails) {
              await shareFolderWith(made.folder.id, email, ops);
              sharedWith.push(email);
            }
            share = { shared: true, folder: folderPath, sharedWith, role: 'reader' };
          }
        } catch (err) {
          // run(), JSON.parse and findOrCreateFolder only ever throw Errors.
          const message = client.scrub((err as Error).message);
          drive = { error: message };
          if (shareApproved) share = { shared: false, sharedWith, reason: `Drive step failed: ${message}` };
        }
      }
      // Not in Drive: the caller still gets the map, inline.
      if (!folder) {
        files.kml!.content = kml;
        files.csv!.content = csv;
      }

      const days: Array<{ day: string; stops: Array<Record<string, unknown>> }> = [];
      mapStops.forEach((stop, i) => {
        const label = dayLabel(stop.dayNumber, stop.date);
        let day = days.at(-1);
        if (day?.day !== label) days.push(day = { day: label, stops: [] });
        day.stops.push(pruneUndefined({
          time: stop.time,
          name: stop.name,
          pin: pinUrl(stop),
          warnings: stopWarnings[i]!.length ? stopWarnings[i] : undefined,
        }));
      });
      const unresolved = mapStops.flatMap((stop, i) => (typeof stop.place?.lat === 'number' && typeof stop.place?.lng === 'number'
        ? []
        : [{ day: dayLabel(stop.dayNumber, stop.date), name: stop.name, reason: resolved[i]!.reason ?? 'no coordinates for this place' }]));

      const rung = resolveView(view, [...VIEWS]);
      const result: CallToolResult = placesResult(pruneUndefined({
        title,
        days,
        unresolved: unresolved.length ? unresolved : undefined,
        files,
        folder,
        drive,
        share,
        importIntoMyMaps: importSteps(title, kmlName, folder ? folderPath : undefined, kmlPath),
        notes: notes.length ? notes : undefined,
        warnings,
        apiCalls: budget.report(),
        places: rung === 'full' ? resolved.map((r) => projectResolved(r, rung)) : undefined,
      }), warnings);
      return result;
    });
  };
}
