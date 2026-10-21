# Export settings templates

## Provenance — read this before trusting these files

Esoteric Software documents the **export dialog**, but not the field names of the JSON its
Save button writes. The files in this folder are therefore **shaped from the documented dialog
options**, not copied from a verified export. They have not been validated against a real verified export
produced by a licensed Spine editor.

This is the reason `export_settings_build` refuses override keys that the template does not
already contain: a wrong template can only produce a wrong file, never a half-applied one.

## Calibration (do this once a license is available)

1. In the Spine editor, configure the Export dialog the way the project needs it and press
   **Save** at the bottom left. That writes a real settings JSON.
2. Or, from the CLI, let Spine write the settings a project last used:

   ```
   Spine -i path/to/project.spine -o calibrated.export.json --last-export-settings
   ```

   The `spine_export_settings_capture` tool wraps that call.
3. Diff the captured file against the matching template here and replace the template with the
   captured field names and values.
4. Re-run `npm test`. The template tests assert structure, not field names, so they keep passing
   once the names are corrected.

Until step 3 is done, treat `export_settings_build` output as a draft: run one real export with
it and confirm the artifacts before wiring it into CI.

## Templates

| File | Intent |
|------|--------|
| `unity-binary.export.json` | Binary skeleton data for shipping into Unity via spine-unity. Smallest and fastest to load. |
| `web-json.export.json` | Pretty-printed JSON for the web runtime and for tools that read the data. |
| `ci-batch.export.json` | Binary data with animation clean up, no warning dialogs, paths supplied per project on the command line. |

## Known behaviour that affects these files

- `-o/--output` and `-i/--input` on the command line **override** whatever the settings file says.
  That is what makes one template reusable across many projects.
- The `-e json` / `-e binary` / `-e json+pack` / `-e binary+pack` shorthands do **not** read these
  files; they use Spine's defaults. Pass a path to a settings file when the settings matter.
- Packing during a data export with the "Attachments" source mode ignores `pack.json` files. When
  per-folder `pack.json` control is needed, run the texture packer as a separate step.
