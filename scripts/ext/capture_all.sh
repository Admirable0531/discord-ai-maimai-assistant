#!/bin/sh
# node scripts/ext/capture.js <id> data/ext/<id>.json for each id given
mkdir -p data/ext
for id in "$@"; do
  [ -s data/ext/$id.json ] || node scripts/ext/capture.js $id data/ext/$id.json 1
done
