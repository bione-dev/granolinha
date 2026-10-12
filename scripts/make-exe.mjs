// Gera app-win/Granolinha.exe: o runtime do Electron renomeado, com o ícone
// e o nome "Granolinha" gravados no executável. É isso que a barra de tarefas,
// o item fixado e o Gerenciador de Tarefas mostram (o ícone da janela sozinho
// não basta: eles leem o .exe).
//
// O executável não leva uma cópia do código: resources/app/index.js carrega
// src/main.js deste projeto. Alterações no código valem sem gerar de novo;
// rode este script só ao atualizar o Electron ou o ícone.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rcedit } from 'rcedit';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'app-win');
const EXE = path.join(OUT, 'Granolinha.exe');
const ICON = path.join(ROOT, 'assets', 'icons', 'app.ico');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const electronDist = path.join(ROOT, 'node_modules', 'electron', 'dist');

function step(msg) {
  console.log(`• ${msg}`);
}

// 1. Cópia limpa do runtime do Electron.
step('copiando o runtime do Electron');
try {
  fs.rmSync(OUT, { recursive: true, force: true });
} catch (err) {
  console.error('Não consegui apagar app-win/. Feche o Granolinha e rode de novo.');
  throw err;
}
fs.cpSync(electronDist, OUT, { recursive: true });
fs.renameSync(path.join(OUT, 'electron.exe'), EXE);
fs.rmSync(path.join(OUT, 'resources', 'default_app.asar'), { force: true });

// 2. resources/app: aponta para o código do projeto.
step('ligando ao código do projeto');
const appDir = path.join(OUT, 'resources', 'app');
fs.mkdirSync(appDir, { recursive: true });
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
  name: 'granolinha', // mantém os dados em %APPDATA%\granolinha
  productName: 'Granolinha',
  version: pkg.version,
  main: 'index.js',
}, null, 2));
fs.writeFileSync(path.join(appDir, 'index.js'),
  `// Gerado por scripts/make-exe.mjs.\nrequire(${JSON.stringify(path.join(ROOT, 'src', 'main.js'))});\n`);

// 3. Ícone e nome dentro do executável.
step('gravando ícone e nome no Granolinha.exe');
const version = `${pkg.version}.0`;
await rcedit(EXE, {
  icon: ICON,
  'file-version': version,
  'product-version': version,
  'version-string': {
    FileDescription: 'Granolinha',
    ProductName: 'Granolinha',
    CompanyName: 'Granolinha',
    InternalFilename: 'Granolinha',
    OriginalFilename: 'Granolinha.exe',
    LegalCopyright: '',
  },
});

// 4. Atalho na área de trabalho. (O do Menu Iniciar o próprio app cria ao
// abrir, com o AppUserModelID certo para agrupar na barra de tarefas.)
step('criando atalho na área de trabalho');
const ps = `
$s = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop') + '\\Granolinha.lnk')
$s.TargetPath = '${EXE.replace(/'/g, "''")}'
$s.WorkingDirectory = '${OUT.replace(/'/g, "''")}'
$s.IconLocation = '${EXE.replace(/'/g, "''")},0'
$s.Description = 'Bloco de notas de reunião'
$s.Save()`;
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit' });

console.log(`\nPronto: ${EXE}`);
console.log('Abra pelo atalho "Granolinha" na área de trabalho ou no Menu Iniciar.');
