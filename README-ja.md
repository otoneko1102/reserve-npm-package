[English](./README.md) | **日本語**

# reserve-npm-package

npm のパッケージ名を簡単に「予約」するための CLI ツールです。指定したパッケージ名を `0.0.0-reserved` というバージョンで一時的に公開します。

## 使い方

- ローカル（対話式）:

  - セットアップ
    `npm install`

  - 実行してプロンプトに従う:
    `npm run reserve`

  - フラグ指定（`npm run` を通す場合は `--` を使用）:
    `npm run reserve -- -p <package-name> -u <username>`

  - または位置引数で（`npm run reserve <package-name> <username>`）:
    `npm run reserve <package-name> <username>`

- CI / GitHub Actions: 付属のワークフロー `.github/workflows/reserve.yml` を使用します（`NPM_TOKEN` をシークレットに設定してください）。

## 動作内容

- リポジトリを一時ディレクトリにコピー（作業ツリーは変更されません）。
- 一時コピー内で `<package-name>` と `<username>` の全出現箇所を置換します（リポジトリ内には保存されません）。
- `process.env.NPM_TOKEN` を使った一時の `.npmrc` を書き込みます。
- その一時コピーから `npm publish` を実行し、`0.0.0-reserved` を公開します。

## 環境

- `NPM_TOKEN` を環境変数で設定する必要があります（CI: シークレットに設定）。

## 注意事項

- リポジトリ自体は変更されません — 置換やファイル削除は一時コピー上でのみ行われます。
- 公開されるパッケージには `.npmignore` に記載されたファイル（存在しない場合はデフォルト候補）が含まれません（公開前に一時コピーから削除します）。
- 予約に成功したパッケージ名はリポジトリルートの `log.txt` に書き込まれます（最新のものが一番上に来ます）。
- `username` は `author` や `LICENSE` 表記などテンプレート置換用であり、公開されるパッケージ名は常に指定した `package-name` のみです（スコープ公開は行いません）。
