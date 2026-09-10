# Marks that are not Simple Icons', and where they come from

Two sets of files, read by two generators.

- `<name>.txt` and `<name>.box.txt` - the path data of the Windows, Apple and
  Linux marks, for `../gen_download_buttons.py`, which draws them into the
  README's download buttons. The `.txt` is the path, the `.box.txt` is the
  viewBox it was drawn in, which is what lets the generator scale three marks of
  different widths to one optical size.
- `<name>.svg` - whole SVG files, for `../gen_brand_glyphs.py`, which turns each
  into a React component in `web/src/components/brandGlyphs.tsx`. These are the
  provider marks Simple Icons does not carry. They are reproduced verbatim,
  gradients, groups and all, because a mark drawn in several tones is several
  tones and flattening one would be redrawing somebody's logo.

## Sources and licences

**Font Awesome Free 6.7.2**, the `brands` set, from <https://fontawesome.com> -
the three platform paths. Font Awesome splits its licence by asset type and only
the ICONS are relevant here: they are **CC BY 4.0**, which asks for attribution
and nothing else. The fonts (SIL OFL 1.1) and the code (MIT) are not used.
Copyright 2024 Fonticons, Inc.

Simple Icons would have been the obvious first stop and does not carry Windows
any more, so all three come from one set instead of two - which also means they
were drawn to one convention and sit at one weight beside each other.

**Each brand's own material**, collected by hand - everything else here. These
are the real drawings rather than a one-colour silhouette of one, and several of
them exist in no icon set at all. The licence is each owner's; what makes their
use here lawful is the trademark position below, not a licence grant.

Some arrive as a **`-dark` / `-light` pair**: one drawing in two inks, where
`-dark` is the dark ink for a light ground and `-light` the white one for a dark
ground. Where a brand has drawn both, the generator uses the pair and skips its
own lightness calculation entirely - the owner's second drawing beats anything
computed from the first.

**Dashboard Icons** (`homarr-labs/dashboard-icons`, <https://dashboardicons.com>)
- `microsoft-onedrive.svg`, `oracle-cloud.svg`, `premiumize.svg`, the three
nobody has supplied. **Apache-2.0**, whose licence text is beside this file as
`LICENSE-dashboard-icons.txt`. Copyright the Homarr Labs team and contributors.
Unlike CC0 this one asks for attribution, which is why it is named here, in the
generator, and in the header of every component built from it.

Apache-2.0 is one-way compatible with this project's AGPL-3.0: these files may be
carried into it, and the combined work stays AGPL-3.0.

Every file is copied unmodified; what the generator produces from one is a
translation into JSX and nothing else. It keeps the drawing's own paths, fills,
gradients and viewBox, prefixes every `id` with the file's name so two marks on
one page cannot swap gradients, and dissolves an Illustrator `<style>` block
into the elements it paints - class names are global to a document, so two marks
both defining `.st0` would have one wearing the other's fill.

## Trademarks

Every mark here is a trademark of its owner. They are used the one way a
trademark may be used without permission, which is to refer to the thing it
names: a platform mark sits on a download button **for that platform**, a
provider mark sits on the row that connects to **that provider**, each is
reproduced unmodified, and nothing here claims endorsement by or affiliation
with any of them.

Three provider marks are a judgement call, recorded because the next person
should not have to guess.

- **Oracle Object Storage** is part of Oracle Cloud Infrastructure and wears the
  Oracle Cloud mark.
- **Yandex Disk** wears Yandex Cloud's mark. Those are two different products -
  Disk is the consumer storage this app connects to, Cloud is Yandex's
  AWS-shaped platform - and the mark supplied was Cloud's.
- **Huawei Drive** wears Huawei Cloud's mark, the same case exactly.

In all three the mark names the right OWNER but a broader product than the row
does. That is the line: a mark naming the right company is better than none, and
a mark naming a **different company's** product is worse than none. Where only
the second was available, the provider gets no mark at all.

## Adding one

For a platform path: take the SVG, keep its `viewBox` verbatim in
`<name>.box.txt`, and put the `d` attribute of its single path in `<name>.txt`. A
mark needing more than one path needs a change to the generator's template as
well, which is deliberate: two paths usually means two colours, and these buttons
draw their marks in one ink.

For a provider mark: drop the SVG in here unchanged, add a line to `LOCAL` in
`../gen_brand_glyphs.py` naming its component, its source and its licence, add
the licence itself to the section above, and set that provider's `Mark` in
`internal/remotes/providers.go`. The generator handles gradients, groups, `style`
attributes and files carrying no viewBox; it refuses a file whose text it would
otherwise silently drop.
