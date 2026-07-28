#!/usr/bin/env bash

LIBPANEL_SRC=./node_modules/libpanel/dist
LIBPANEL_DST=./dist/libs/libpanel

mkdir -p $(dirname $LIBPANEL_DST)

if [ -d $LIBPANEL_DST ]; then
	rm -r $LIBPANEL_DST
fi
cp -r $LIBPANEL_SRC $LIBPANEL_DST