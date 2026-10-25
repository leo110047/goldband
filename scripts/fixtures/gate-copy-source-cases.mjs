// Gate G recursive copy sources across the working directories a command may
// run in: [command, protected], run in the project gate-protection-cases.mjs
// describes. A source missing or a glob unmatched in any of them counts as
// holding every protected name even where another directory holds a listed
// copy; sources are listed as they exist before the command runs.
export const copySourceCases = [
  ['cd src; cd ..; cp -r docs out/', true],
  ['cd src || true; ln -s ../kit docs; cp -R docs/. ../out/', true],
  ['mkdir nd; cd nd; ln -s ../kit docs; cp -R docs/. ..', true],
  ['cd src; cp -r kit out/', true],
  ['cd docs; cp -R big out/', true],
  ['cd src; cp -R missing out/', true],
  ['cd src; ln -s ../kit docs; cp -R do* ../out/', true],
  ['mkdir nd; cd nd; ln -s ../kit docs; cp -R do*/. ..', true],
];
