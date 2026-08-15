import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

/**
 * tsconfig's `@/*` alias means nothing to node, & app modules import each other without a file
 * extension => teach the loader both conventions so a test can import the real modules instead
 * of a copy of them. sync hooks, so `node --test` needs no extra worker setup.
 */
const SRC = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const HERE = dirname(fileURLToPath(import.meta.url));

/** bare specifiers node can't resolve on its own, pointed at a stub instead */
const STUBS = {
  'next/headers': resolvePath(HERE, 'stubs', 'next-headers.mjs'),
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in STUBS) {
      return nextResolve(pathToFileURL(STUBS[specifier]).href, context);
    }

    const aliased = specifier.startsWith('@/');
    const target = aliased ? pathToFileURL(resolvePath(SRC, specifier.slice(2))).href : specifier;
    try {
      return nextResolve(target, context);
    } catch (err) {
      // extensionless "./mime" => "./mime.ts". own-source specifiers only, so a missing package
      // still surfaces as a missing package.
      const ours = aliased || target.startsWith('.') || target.startsWith('file:');
      if (err?.code !== 'ERR_MODULE_NOT_FOUND' || !ours || /\.[a-z]+$/.test(target)) throw err;
      return nextResolve(`${target}.ts`, context);
    }
  },
});
