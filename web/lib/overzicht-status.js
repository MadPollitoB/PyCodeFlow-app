'use strict';
// PyCodeFlow — status-gedreven toets-/taakoverzicht (v2026.2.51.102)
// Pure logica (geen I/O): welke status heeft een toets/taak, welke hoofdknop en
// welke knoppen achter het pijltje. Zo is alles zonder server of database te testen.
//
// Statussen: concept | actief | te_verbeteren | afgerond | archief
//  - actief        : gepland, open, of een open individuele heropening
//  - te_verbeteren : gesloten, en minstens één ingediende leerling is nog niet volledig verbeterd
//  - afgerond      : gesloten en alles verbeterd (of niemand diende in)
//  - archief       : gearchiveerd (heeft voorrang op alles behalve concept-vlag niet nodig)

const STATUSSEN = ['actief', 'te_verbeteren', 'afgerond', 'archief', 'concept'];

// Verbeterd = elke vraag van een ingediende leerling heeft een score
// (afwezig / niet-ingediend / gewettigd blokkeren niet; AI-scores tellen mee).
function isVolledigVerbeterd(ingediend, verbeterd) {
  return (Number(verbeterd) || 0) >= (Number(ingediend) || 0);
}

function bepaalOverzichtStatus(r) {
  if (!r) return 'afgerond';
  if (r.archived) return 'archief';
  if (r.isPreview) return 'concept';
  const dicht = r.availability === 'closed' || r.availability === 'expired' || !!r.stoppedAt;
  if (!dicht || r.individualOpen) return 'actief';
  return isVolledigVerbeterd(r.ingediend, r.verbeterd) ? 'afgerond' : 'te_verbeteren';
}

// Actief én echt bezig (venster open of individuele heropening) versus nog gepland.
function isGestart(r) {
  return !!r && (r.availability === 'open' || !!r.individualOpen);
}

// Geeft { primary: id, more: [id...] }. Ids worden door de client op label/handler gemapt.
function knoppenVoorStatus(status, r) {
  r = r || {};
  switch (status) {
    case 'concept':
      return { primary: 'activeren', more: ['doorlopen', 'bewerken', 'dupliceren', 'verwijderen'] };
    case 'actief': {
      if (isGestart(r)) {
        const kb = !!r.klasbordActief;
        const more = [];
        if (kb) more.push('live'); // live blijft bereikbaar als klasbord hoofdknop is
        more.push('voortgang', 'stoppen', 'dupliceren', 'verwijderen');
        return { primary: kb ? 'klasbord' : 'live', more };
      }
      if (r.editable) return { primary: 'bewerken', more: ['dupliceren', 'verwijderen'] };
      return { primary: 'live', more: ['dupliceren', 'verwijderen'] };
    }
    case 'te_verbeteren':
      return { primary: 'verbeteren', more: ['heropenen', 'dupliceren', 'sjabloon', 'verwijderen'] };
    case 'afgerond':
      return { primary: 'scores', more: ['heropenen', 'dupliceren', 'sjabloon', 'archiveren', 'verwijderen'] };
    case 'archief':
      return { primary: 'scores', more: ['uit_archief', 'dupliceren', 'verwijderen'] };
    default:
      return { primary: 'scores', more: ['dupliceren', 'verwijderen'] };
  }
}

module.exports = { STATUSSEN, isVolledigVerbeterd, bepaalOverzichtStatus, isGestart, knoppenVoorStatus };
