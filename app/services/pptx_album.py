from io import BytesIO

from PIL import ImageFont
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE
from pptx.util import Inches, Pt

from app.services.captions import CAPTION_FIELDS, caption_lines
from app.services.scanner import render_photo

_SLIDE_HEIGHT = 7.5
_CAPTION_HEIGHT = 1.45
_FONT_SIZE = 22


def _textbox(slide, text, x, y, width, height, size=_FONT_SIZE):
    shape = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(width), Inches(height))
    frame = shape.text_frame
    frame.clear()
    frame.word_wrap = False
    frame.auto_size = MSO_AUTO_SIZE.NONE
    frame.vertical_anchor = MSO_ANCHOR.TOP
    frame.margin_left = frame.margin_right = 0
    frame.margin_top = frame.margin_bottom = 0
    for index, line in enumerate(text.split('\n')):
        paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        paragraph.text = line
        paragraph.font.name = 'Arial'
        paragraph.font.size = Pt(size)
        paragraph.font.color.rgb = RGBColor(255, 255, 255)
        paragraph.space_before = paragraph.space_after = Pt(0)
        paragraph.line_spacing = Pt(size * 1.2)
    return shape


def _caption_excerpt(text, width, size=_FONT_SIZE, max_lines=3):
    font = ImageFont.truetype('DejaVuSans.ttf', size)
    limit = width * 72 * 0.95
    lines = []
    for original in text.splitlines():
        line = ''
        for word in original.split():
            candidate = f'{line} {word}'.strip()
            if font.getlength(candidate) <= limit:
                line = candidate
                continue
            if line:
                lines.append(line)
                line = ''
            for character in word:
                if font.getlength(line + character) > limit:
                    lines.append(line)
                    line = ''
                line += character
        if line:
            lines.append(line)
    if len(lines) <= max_lines:
        return '\n'.join(lines), False
    excerpt = lines[:max_lines]
    while font.getlength(excerpt[-1] + ' …') > limit:
        excerpt[-1] = excerpt[-1][:-1]
    excerpt[-1] += ' …'
    return '\n'.join(excerpt), True


def _add_picture(slide, stream, dimensions, width, height, fit):
    iw, ih = dimensions
    if fit == 'contain':
        scale = min(width / iw, height / ih)
        w, h = iw * scale, ih * scale
        picture = slide.shapes.add_picture(
            stream, Inches((width - w) / 2), Inches((height - h) / 2), Inches(w), Inches(h),
        )
    else:
        picture = slide.shapes.add_picture(stream, 0, 0, Inches(width), Inches(height))
        scale = max(width / iw, height / ih)
        picture.crop_left = picture.crop_right = (1 - width / (iw * scale)) / 2
        picture.crop_top = picture.crop_bottom = (1 - height / (ih * scale)) / 2
    return picture


def build_presentation(album, destination, *, aspect='16:9', fit='contain',
                       metadata='slide', fields=('date', 'place'), quality='normal', title_slide=False):
    presentation = Presentation()
    width = 40 / 3 if aspect == '16:9' else 10
    presentation.slide_width = Inches(width)
    presentation.slide_height = Inches(_SLIDE_HEIGHT)
    presentation.core_properties.title = album.name
    presentation.core_properties.author = 'Fotoscan'
    presentation.core_properties.subject = ''
    presentation.core_properties.comments = ''
    blank = presentation.slide_layouts[6]
    max_size = 3840 if quality == 'high' else 1920
    overflow_count = 0

    def new_slide():
        slide = presentation.slides.add_slide(blank)
        slide.background.fill.solid()
        slide.background.fill.fore_color.rgb = RGBColor(0, 0, 0)
        return slide

    if title_slide:
        slide = new_slide()
        title, shortened = _caption_excerpt(album.name, width - 1, size=36, max_lines=4)
        _textbox(slide, title, 0.5, 2.2, width - 1, 3, size=36)
        if shortened:
            slide.notes_slide.notes_text_frame.text = album.name

    for entry in album.entries:
        photo = entry.photo
        selected = caption_lines(photo, fields) if metadata != 'none' else []
        text = '\n'.join(f"{CAPTION_FIELDS[line['key']][0]}: {line['text']}" for line in selected)
        visible = metadata in ('slide', 'both') and bool(text)
        height = _SLIDE_HEIGHT - _CAPTION_HEIGHT if visible else _SLIDE_HEIGHT
        try:
            with render_photo(photo) as image:
                image.thumbnail((max_size, max_size))
                image.info.clear()
                stream = BytesIO()
                image.save(stream, 'JPEG', quality=90)
                dimensions = image.size
        except (OSError, ValueError) as error:
            raise ValueError(f'Kunde inte läsa bilden {photo.filename}. Kontrollera originalfilen.') from error
        stream.seek(0)
        slide = new_slide()
        _add_picture(slide, stream, dimensions, width, height, fit)
        stream.close()
        shortened = False
        if visible:
            excerpt, shortened = _caption_excerpt(text, width - 0.8)
            _textbox(slide, excerpt, 0.4, height + 0.15, width - 0.8, _CAPTION_HEIGHT - 0.3)
        if text and (metadata in ('notes', 'both') or shortened):
            slide.notes_slide.notes_text_frame.text = text
        overflow_count += int(shortened)
    presentation.save(destination)
    return {'slides': len(presentation.slides), 'overflow_count': overflow_count}
