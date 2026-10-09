import { BASE_TOOL_REGISTRARS } from '../src/server.js';
import { describeToolAnnotations, LOCAL_AUTH_TOOLS } from './support/tool-annotations.js';

describeToolAnnotations(BASE_TOOL_REGISTRARS as never, { tools: 115, destructive: 49, local: LOCAL_AUTH_TOOLS });
