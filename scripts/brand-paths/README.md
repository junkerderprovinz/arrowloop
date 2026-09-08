# Platform marks, and where they come from

The three files here are the path data of the Windows, Apple and Linux marks,
lifted out of their source SVGs so that `../gen_download_buttons.py` can draw
them into the README's download buttons. Each `<name>.txt` is the path, and
each `<name>.box.txt` is the viewBox it was drawn in, which is what lets the
generator scale three marks of different widths to one optical size.

## Source and licence

**Font Awesome Free 6.7.2**, the `brands` set, from
<https://fontawesome.com>. Font Awesome splits its licence by asset type, and
only the ICONS are relevant here: they are **CC BY 4.0**, which asks for
attribution and nothing else. The fonts (SIL OFL 1.1) and the code (MIT) are not
used. Copyright 2024 Fonticons, Inc.

Simple Icons would have been the obvious first stop and does not carry Windows
any more, so all three come from one set instead of two - which also means they
were drawn to one convention and sit at one weight beside each other.

## Trademarks

Each mark is a trademark of its owner: Microsoft Corporation, Apple Inc. and
Linus Torvalds respectively. They are used here the one way a trademark may be
used without permission, which is to refer to the thing it names. Every button
carrying one links to a download **for that platform**, the marks are
reproduced unmodified, and nothing about them claims endorsement by or
affiliation with those owners.

## Replacing one

Take the SVG from the source above, keep its `viewBox` verbatim in
`<name>.box.txt`, and put the `d` attribute of its single path in `<name>.txt`.
A mark that needs more than one path needs a change to the generator's template
as well, which is deliberate: two paths usually means two colours, and these
buttons draw their marks in one ink.
