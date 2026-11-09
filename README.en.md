# Wisdom Cultivator (知习)

A local-first Windows desktop practice app for digital IC, Verilog, Python, C and C++. Built with Electron, React, TypeScript, Monaco and SQLite. Current version: 0.2.0.

Features include objective grading, code/RTL execution, QBank 1.0 imports, spaced review, bookmarks, notes, statistics, backups, and a native launcher with startup progress and rotating learning messages.

See the [Chinese README](README.md) for setup, packaging, question banks and documentation.

```powershell
cd tech-practice
npm ci
npm run prepare:assets
npm test
npm run build
npm start
```

Node.js 24 is required. Downloaded toolchains, build output and personal learning databases are excluded. Configure Python, C/C++ or Icarus Verilog in the app as needed. Run npm run package on Windows to build the portable application.
