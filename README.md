**English** | [日本語](./README-ja.md)

# reserve-npm-package

CLI tool to "reserve" an npm package name by publishing a temporary version `0.0.0-reserved`.

## Usage

> [!Warning]  
> `PAT` with `Read and Write` permissions for `All Packages` is required.

- Local (interactive):

  - Setup
    ```bash
    git clone https://github.com/otoneko1102/reserve-npm-package.git
    cd reserve-npm-package
    npm install
    ```

  - Run and follow prompts:
    `npm run reserve`

  - Provide flags (use `--` to forward flags through `npm run`):
    `npm run reserve -- -p <package-name> -u <username>`

  - Or use *positional* args without `--` (works with `npm run` directly):
    `npm run reserve <package-name> <username>`

- CI / GitHub Actions: use the included workflow `.github/workflows/reserve.yml` (provide secret `NPM_TOKEN`).

## How it works

- Creates a temporary copy of the repository (does not modify your working tree).
- Replaces every occurrence of `<package-name>` and `<username>` inside the temporary copy.
- Writes a temporary `.npmrc` that uses `process.env.NPM_TOKEN`.
- Runs `npm publish` from the temporary copy (the published version is `0.0.0-reserved`).

## Environment

- Requires `NPM_TOKEN` set in the environment (CI: set as secret `NPM_TOKEN`).

## Notes

- The repository itself is not modified — all replacements happen in a temporary workspace.
- The package.json `version` should (and by default is) `0.0.0-reserved` for reservation.
- Files matching entries in `.npmignore` (or fallback defaults) are **not** included in the published package — the tool removes them from the temporary copy before publishing.
- Successful reservations are recorded in `log.txt` (repository root); the newest reserved package is written at the top of the file.
- If an unscoped publish is rejected (name already used or "too similar"), the CLI will **not** publish a scoped package. The `username` is used only for `author`/LICENSE placeholders; supply a different `package-name` to reserve.

