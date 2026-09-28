# Before the bento homepage

This snapshot contains every existing file changed by the bento experiment: `index.html`, `assets/js/main.js`, and `assets/js/ui-sounds.js`. Existing stylesheets, project pages, fonts, audio, and image assets are left unchanged by the experiment. Its new styles are isolated in `assets/css/home-bento.css`.

To restore the previous black homepage with the cursor-revealed circuit video, run from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File backups/2026-09-26-before-bento/restore.ps1
```

The restore script saves the current versions into a new timestamped sibling backup before restoring this snapshot, so the bento version remains recoverable too. It does not delete any files. Hard refresh your browser afterward.
