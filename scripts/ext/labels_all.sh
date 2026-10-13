#!/bin/sh
# node scripts/ext/labels.js <id> data/ext/<id>.lab.json for each id given
mkdir -p data/ext
for id in "$@"; do
  [ -s data/ext/$id.lab.json ] || node scripts/ext/labels.js $id data/ext/$id.lab.json 1
done
