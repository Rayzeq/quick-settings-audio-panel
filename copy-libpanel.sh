#!/usr/bin/env bash

LIBPANEL_SRC=./node_modules/libpanel/dist
LIBPANEL_DST=./dist/libs/libpanel

mkdir -p $(dirname $LIBPANEL_DST)

rm -r $LIBPANEL_DST
cp -r $LIBPANEL_SRC $LIBPANEL_DST