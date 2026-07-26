#!/usr/bin/env python3
"""
PyCodeFlow — genereert het INVULBARE testdocument-PDF (checklist-stijl) uit
testdocument-html/testpunten.js (dezelfde bron als de HTML-versie).

Gebruik:  python3 scripts/make-testdoc-pdf.py
Schrijft: PyCodeFlow-testdocument-v<versie>.pdf (projectroot)

Stijl volgt het klassieke testdocument: per testpunt lege kolommen OK / NOK /
Opmerking om met de hand (of digitaal) aan te kruisen, kopvelden bovenaan en
een samenvattingspagina achteraan. Tip: de HTML-versie (testdocument-html/)
vult zichzelf in en exporteert dezelfde lay-out mét je antwoorden.
"""
import os, re, json, html

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, KeepTogether)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRON = os.path.join(ROOT, 'testdocument-html', 'testpunten.js')

# testpunten.js = "window.TESTPUNTEN = {...};" → strip de JS-wikkel, parse als JSON
ruw = open(BRON, encoding='utf-8').read()
ruw = re.sub(r'^.*?window\.TESTPUNTEN\s*=\s*', '', ruw, flags=re.S).rstrip().rstrip(';')
ruw = re.sub(r'^\s*//.*$', '', ruw, flags=re.M)  # regels met // commentaar weg
D = json.loads(ruw)

VERSIE = D.get('versie', 'dev')
DOEL = os.path.join(ROOT, f'PyCodeFlow-testdocument-v{VERSIE}.pdf')

BLAUW = colors.HexColor('#1d4ed8')
styles = getSampleStyleSheet()
S = {
    'titel': ParagraphStyle('titel', parent=styles['Title'], fontSize=18, spaceAfter=2),
    'sub':   ParagraphStyle('sub', parent=styles['Normal'], fontSize=9, textColor=colors.HexColor('#555'), spaceAfter=10),
    'h2':    ParagraphStyle('h2', parent=styles['Heading1'], fontSize=12.5, textColor=BLAUW, spaceBefore=12, spaceAfter=4),
    'h3':    ParagraphStyle('h3', parent=styles['Heading2'], fontSize=10, spaceBefore=7, spaceAfter=3),
    'p':     ParagraphStyle('p', parent=styles['Normal'], fontSize=8.6, leading=11),
    'cel':   ParagraphStyle('cel', parent=styles['Normal'], fontSize=8.2, leading=10.5),
    'kop':   ParagraphStyle('kop', parent=styles['Normal'], fontSize=8.2, leading=10.5, fontName='Helvetica-Bold'),
}

def P(t, st='cel'):
    return Paragraph(html.escape(t, quote=False), S[st])

story = []
story.append(Paragraph('PyCodeFlow — Testdocument', S['titel']))
story.append(Paragraph(f"Volledige functionele en visuele testronde &bull; versie v{VERSIE} &bull; {D.get('datum','')}", S['sub']))

# Kopvelden (in te vullen)
velden = ['Getest door', 'Datum', 'Omgeving (prod / test)', 'Browser + versie', 'Versie in voettekst', '/api/version']
kop = Table([[P(v, 'kop'), ''] for v in velden], colWidths=[52*mm, 118*mm])
kop.setStyle(TableStyle([('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#999')),
                         ('BACKGROUND', (0,0), (0,-1), colors.HexColor('#eff6ff')),
                         ('TOPPADDING', (0,0), (-1,-1), 3), ('BOTTOMPADDING', (0,0), (-1,-1), 5)]))
story.append(kop)

story.append(Paragraph('Hoe gebruik je dit document', S['h2']))
story.append(Paragraph(
    'Kruis per testpunt <b>OK</b> of <b>NOK</b> aan. Noteer bij NOK kort wat je ziet in de kolom '
    '<b>Opmerking</b> — liefst met de exacte foutmelding. Niet testbaar? Laat leeg en noteer '
    "'n.v.t.'. Geef het ingevulde document terug, dan worden de NOK-punten als sprints in de "
    'sprintlog opgenomen. <b>Tip:</b> de map <b>testdocument-html/</b> bevat dezelfde checklist als '
    'invulbare pagina met tabbladen, automatische samenvatting en PDF-export.', S['p']))
story.append(Spacer(1, 4))
story.append(Paragraph(
    '<b>Belangrijk vooraf:</b> maak een database-backup vóór je een nieuwe versie uitrolt en draai '
    'daarna sync-version.sh. Seed de testdata via pycodeflow.sh optie 21 (SEED).', S['p']))
story.append(Paragraph('Testvolgorde (aanbevolen)', S['h2']))
story.append(Paragraph('De secties hieronder staan al in de aanbevolen volgorde — werk ze van voor '
                       'naar achter af, dan loop je precies één keer door de hele applicatie.', S['p']))

# Secties met invultabellen
BREED = [None, 12*mm, 12*mm, 48*mm]  # Testpunt | OK | NOK | Opmerking
for tab in D['tabs']:
    story.append(Paragraph(html.escape(tab['titel']) + ' — ' + html.escape(tab['kort']), S['h2']))
    for sec in tab['secties']:
        rijen = [[P('Testpunt', 'kop'), P('OK', 'kop'), P('NOK', 'kop'), P('Opmerking', 'kop')]]
        for p in sec['punten']:
            rijen.append([P(p), '', '', ''])
        t = Table(rijen, colWidths=[178*mm - BREED[1] - BREED[2] - BREED[3], BREED[1], BREED[2], BREED[3]],
                  repeatRows=1)
        t.setStyle(TableStyle([
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#999')),
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#e5e7eb')),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('TOPPADDING', (0,0), (-1,-1), 2.5), ('BOTTOMPADDING', (0,0), (-1,-1), 4),
            ('LEFTPADDING', (0,0), (-1,-1), 4), ('RIGHTPADDING', (0,0), (-1,-1), 4),
        ]))
        story.append(KeepTogether([Paragraph(html.escape(sec['kop']), S['h3']), t]))

# Samenvattingspagina
from reportlab.platypus import PageBreak
story.append(PageBreak())
story.append(Paragraph('Samenvatting van de testronde', S['h2']))
samen = Table([[P('Aantal getest', 'kop'), P('Aantal OK', 'kop'), P('Aantal NOK', 'kop')],
               ['', '', '']], colWidths=[59*mm, 59*mm, 59*mm], rowHeights=[8*mm, 12*mm])
samen.setStyle(TableStyle([('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#999')),
                           ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#e5e7eb'))]))
story.append(samen)
story.append(Paragraph('Gevonden problemen (kort) — worden sprints', S['h2']))
prob = [[P('Nr', 'kop'), P('Sectie', 'kop'), P('Probleem / foutmelding', 'kop'), P('Prioriteit', 'kop')]]
for i in range(1, 13):
    prob.append([P(str(i)), '', '', ''])
tp = Table(prob, colWidths=[10*mm, 34*mm, 108*mm, 25*mm], rowHeights=[7*mm]+[9*mm]*12)
tp.setStyle(TableStyle([('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#999')),
                        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#e5e7eb'))]))
story.append(tp)
story.append(Paragraph('Algemene opmerkingen', S['h2']))
opm = Table([['']], colWidths=[177*mm], rowHeights=[45*mm])
opm.setStyle(TableStyle([('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#999'))]))
story.append(opm)

doc = SimpleDocTemplate(DOEL, pagesize=A4, leftMargin=16*mm, rightMargin=16*mm,
                        topMargin=13*mm, bottomMargin=14*mm,
                        title=f'PyCodeFlow testdocument v{VERSIE}', author='PyCodeFlow')

def voet(canvas, _doc):
    canvas.setFont('Helvetica', 7.5)
    canvas.setFillColor(colors.HexColor('#6b7280'))
    canvas.drawString(16*mm, 8*mm, f'PyCodeFlow — testdocument v{VERSIE}')
    canvas.drawRightString(A4[0]-16*mm, 8*mm, f'Pagina {canvas.getPageNumber()}')

doc.build(story, onFirstPage=voet, onLaterPages=voet)
print('OK →', DOEL)
