const vsce = require('@vscode/vsce');

console.log('Starting package creation...');

vsce.createVSIX({ cwd: '.' })
  .then((result) => {
    console.log('Package created successfully!');
    console.log('Output:', result);
  })
  .catch(e => {
    console.error('Error creating package:', e);
    process.exit(1);
  });
