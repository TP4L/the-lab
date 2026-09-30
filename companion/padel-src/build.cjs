const path=require('node:path');
require('esbuild').buildSync({absWorkingDir:__dirname,entryPoints:['main.tsx'],outfile:'../web/padel/board.js',bundle:true,minify:true,jsx:'automatic',platform:'browser',define:{'process.env.NODE_ENV':'"production"'}});
