"""The game's copy of the title art: the 960 x 540 render boxed down to 480 x 270 and held to 160 colours
(needs Pillow: pip install pillow). Usage: pixelate.py <master.png> <out.png>"""
import sys

from PIL import Image

im = Image.open(sys.argv[1]).convert('RGB')
small = im.resize((480, 270), Image.BOX)
small.quantize(160, method=Image.Quantize.MAXCOVERAGE, dither=Image.Dither.NONE).save(sys.argv[2], optimize=True)
