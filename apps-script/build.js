// Gộp CSS + JS vào một file Index.html duy nhất để dán vào Apps Script editor: node apps-script/build.js
const fs = require('fs'); const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const out = read('src/template.html')
  .replace('/*STYLE*/', () => read('../public/style.css'))
  .replace('/*SCRIPT*/', () => read('src/client.js'));
fs.writeFileSync(path.join(__dirname, 'Index.html'), out);
console.log(`Index.html: ${(out.length / 1024).toFixed(1)} KB`);
