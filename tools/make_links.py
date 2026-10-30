#!/usr/bin/env python3
"""LINE案内タブの「お名前」から、個別専用ページのURLを作って表示する。

URLの p= は名前から作るハッシュ（me/index.html と同じ計算）。ページ側は
顧客リストの担当者名と LINE案内のお名前をそれぞれハッシュして、一致した人を表示する。
名前の表記ゆれ（スペース・髙/高・かっこ）はそろえてから計算するので、
「重原悠香」と「重原　悠香」は同じURLになる。

使い方: python3 tools/make_links.py            # LINE案内の全員
        python3 tools/make_links.py 山田まなみ  # 指定した名前だけ
"""
import csv
import hashlib
import io
import re
import sys
import unicodedata
import urllib.request

SHEET_ID = '1UeSu6tEnX1OwPfV_G6rxD4dIX42_jW8EEXveBNb7kH4'
LINE_GID = '310129667'
SALT = 'tabicari-me:'
BASE = 'https://auscheersmate11-afk.github.io/tabicari-dashboard/me/?p='


def norm_key(s):
    s = unicodedata.normalize('NFKC', s or '')
    s = re.sub(r'\([^)]*\)', '', s)
    s = re.sub(r'\s+', '', s)
    return s.replace('髙', '高').replace('﨑', '崎').lower()


def token(name):
    return hashlib.sha256((SALT + norm_key(name)).encode('utf-8')).hexdigest()[:10]


def line_names():
    url = f'https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&headers=1&gid={LINE_GID}'
    text = urllib.request.urlopen(url).read().decode('utf-8-sig')
    rows = list(csv.reader(io.StringIO(text)))
    col = rows[0].index('お名前') if 'お名前' in rows[0] else 0
    return [r[col].strip() for r in rows[1:] if len(r) > col and r[col].strip()]


if __name__ == '__main__':
    names = sys.argv[1:] or line_names()
    for n in names:
        print(f'{n}\t{BASE}{token(n)}')
