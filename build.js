const fs = require('fs');
const path = require('path');
const { minify } = require('html-minifier-terser');

async function build() {
    console.log('Building production version...\n');

    // Read the original HTML
    const htmlPath = path.join(__dirname, 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Backup original
    const backupPath = path.join(__dirname, 'index.dev.html');
    if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(htmlPath, backupPath);
        console.log('Backed up original to index.dev.html');
    }

    // Minify HTML with inline JS and CSS
    const minified = await minify(html, {
        collapseWhitespace: true,
        removeComments: true,
        removeRedundantAttributes: true,
        removeScriptTypeAttributes: true,
        removeStyleLinkTypeAttributes: true,
        useShortDoctype: true,
        minifyCSS: true,
        minifyJS: {
            compress: {
                drop_console: false,
                dead_code: true,
                drop_debugger: true,
                evaluate: true,
                booleans: true,
                loops: true,
                unused: true,
                hoist_funs: true,
                keep_fargs: false,
                hoist_vars: false,
                if_return: true,
                join_vars: true,
                side_effects: true,
            },
            mangle: {
                toplevel: false,
                reserved: ['players', 'renderTable', 'startSearch', 'stopSearch',
                           'sortTable', 'filterPlayers', 'exportPlayers', 'importPlayers',
                           'deleteSelected', 'clearSavedPlayers', 'copyToClipboard',
                           'setRankMode', 'updateLPDisplay', 'toggleSelectAll',
                           'updateSelection', 'handleCheckboxClick', 'testRateLimit']
            },
            output: {
                comments: false
            }
        }
    });

    // Overwrite index.html with minified version
    fs.writeFileSync(htmlPath, minified);

    // Stats
    const originalSize = Buffer.byteLength(html, 'utf8');
    const minifiedSize = Buffer.byteLength(minified, 'utf8');
    const savings = ((1 - minifiedSize / originalSize) * 100).toFixed(1);

    console.log(`Original:  ${(originalSize / 1024).toFixed(1)} KB`);
    console.log(`Minified:  ${(minifiedSize / 1024).toFixed(1)} KB`);
    console.log(`Savings:   ${savings}%\n`);
    console.log('index.html has been minified in place.');
    console.log('Original backed up to index.dev.html');
}

build().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
});
