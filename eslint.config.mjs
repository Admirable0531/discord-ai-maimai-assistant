import js from '@eslint/js';

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'commonjs',
            globals: {
                process: 'readonly',
                console: 'readonly',
                __dirname: 'readonly',
                module: 'writable',
                require: 'readonly',
                fetch: 'readonly',
                AbortSignal: 'readonly',
                setTimeout: 'readonly',
                setInterval: 'readonly',
                clearTimeout: 'readonly',
                clearInterval: 'readonly',
                Buffer: 'readonly',
                URL: 'readonly',
                URLSearchParams: 'readonly',
                // src/web/maimaiAccountSession.js passes callbacks into
                // Playwright's page.evaluate() that run in a real browser
                // context, not Node — this global only exists there, but
                // ESLint parses the whole file as one scope.
                document: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-empty': 'warn',
        },
    },
    {
        ignores: ['node_modules/', 'data/'],
    },
];
