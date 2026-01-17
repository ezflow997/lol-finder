const fs = require('fs');
const path = require('path');
const { minify } = require('html-minifier-terser');

async function build() {
    console.log('Building production version...\n');

    // Read the original HTML
    const htmlPath = path.join(__dirname, 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

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
                drop_console: false, // Keep console for debugging
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

    // Create dist directory
    const distDir = path.join(__dirname, 'dist');
    if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir);
    }

    // Write minified HTML
    const outputPath = path.join(distDir, 'index.html');
    fs.writeFileSync(outputPath, minified);

    // Copy server files to dist
    fs.copyFileSync(
        path.join(__dirname, 'server.js'),
        path.join(distDir, 'server.js')
    );
    fs.copyFileSync(
        path.join(__dirname, 'scout.js'),
        path.join(distDir, 'scout.js')
    );
    fs.copyFileSync(
        path.join(__dirname, 'package.json'),
        path.join(distDir, 'package.json')
    );
    fs.copyFileSync(
        path.join(__dirname, 'vercel.json'),
        path.join(distDir, 'vercel.json')
    );

    // Stats
    const originalSize = Buffer.byteLength(html, 'utf8');
    const minifiedSize = Buffer.byteLength(minified, 'utf8');
    const savings = ((1 - minifiedSize / originalSize) * 100).toFixed(1);

    console.log(`Original:  ${(originalSize / 1024).toFixed(1)} KB`);
    console.log(`Minified:  ${(minifiedSize / 1024).toFixed(1)} KB`);
    console.log(`Savings:   ${savings}%\n`);
    console.log(`Output written to: ${distDir}`);
    console.log('\nTo deploy, push the dist/ folder to Vercel or run from dist/');
}

build().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
});
