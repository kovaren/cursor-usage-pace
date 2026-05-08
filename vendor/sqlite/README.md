# Bundled SQLite Tools

This directory contains platform-specific `sqlite3` command-line binaries used
to read Cursor's `state.vscdb` without shipping native Node modules.

The binaries are downloaded from the official SQLite download page:

https://www.sqlite.org/download.html

SQLite is in the public domain. Refresh these files with:

```sh
npm run sqlite:download
```
