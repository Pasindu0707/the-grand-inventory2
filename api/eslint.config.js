import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts', 'test/**/*.ts'],
        languageOptions: {
            parser: tseslint.parser,
            ecmaVersion: 2023,
            sourceType: 'module',
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
            /**
             * The build note that this whole design rests on:
             *
             *   "Never write to stock_ledger from a controller. One service
             *    function per document type; the document is the API, the
             *    ledger is a consequence."
             *
             * A convention lasts until the first person in a hurry. This makes
             * it fail the build instead. services/ledger.ts is the only module
             * that may touch the table, and it is excluded below.
             */
            'no-restricted-syntax': [
                'error',
                {
                    selector:
                        "CallExpression[callee.property.name='insertInto'][arguments.0.value='stock_ledger']",
                    message:
                        'Only services/ledger.ts may write to stock_ledger. Use postDocument() - the document is the API, the ledger is a consequence.',
                },
                {
                    selector:
                        "CallExpression[callee.property.name='updateTable'][arguments.0.value='stock_ledger']",
                    message:
                        'stock_ledger is append-only. Corrections are reversals: use reverseDocument().',
                },
                {
                    selector:
                        "CallExpression[callee.property.name='deleteFrom'][arguments.0.value='stock_ledger']",
                    message:
                        'stock_ledger rows are never deleted. Corrections are reversals: use reverseDocument().',
                },
            ],
        },
    },
    {
        // services/ledger.ts is the one module allowed to write the ledger.
        // ledger.test.ts is allowed to *attempt* an update and a delete,
        // because proving the database rejects them is the point of the test.
        files: ['src/services/ledger.ts', 'test/ledger.test.ts'],
        rules: { 'no-restricted-syntax': 'off' },
    },
    {
        ignores: ['dist/**', 'node_modules/**'],
    }
);
