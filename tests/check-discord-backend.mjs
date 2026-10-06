// Offline strict check. Deno's pinned npm import is mapped to the installed Supabase types.
import ts from 'typescript';
import path from 'node:path';
const options = {
  strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true,
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, baseUrl: process.cwd(),
  paths: { 'npm:@supabase/supabase-js@2.57.4': ['node_modules/@supabase/supabase-js'] },
};
const host = ts.createCompilerHost(options);
const ambient = path.join(process.cwd(), 'nexium-deno-ambient.d.ts');
const read = host.readFile.bind(host), exists = host.fileExists.bind(host);
host.readFile = file => file === ambient ? 'declare const Deno: { env: { get(name:string):string|undefined }; serve(handler:(req:Request)=>Response|Promise<Response>):void };' : read(file);
host.fileExists = file => file === ambient || exists(file);
const program = ts.createProgram(['supabase/functions/discord-executor/index.ts','supabase/functions/discord-oauth/index.ts', ambient], options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
for (const d of diagnostics) process.stdout.write(ts.flattenDiagnosticMessageText(d.messageText, '\n') + '\n');
if (diagnostics.length) process.exit(1);
process.stdout.write('PASS: strict backend check with installed Supabase types and Deno ambient declarations\n');
