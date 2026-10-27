// Vocabularies from the C2PA 2.x and CAWG specifications, used by the editor forms.

export const IPTC = 'http://cv.iptc.org/newscodes/digitalsourcetype/';

export const SOURCE_TYPES = [
  { group: 'Captured', items: [
    ['digitalCapture', 'Original digital capture', 'Captured by a camera or recorder from a real-life scene.'],
    ['computationalCapture', 'Computational capture', 'Captured, then processed by on-device algorithms (e.g. night mode, HDR).'],
    ['negativeFilm', 'Digitised negative film', ''],
    ['positiveFilm', 'Digitised positive film', ''],
    ['print', 'Digitised print', 'Scan of a non-transparent printed medium.'],
    ['screenCapture', 'Screen capture', 'Screenshot or screen recording.'],
    ['virtualRecording', 'Virtual recording', 'Recording of a virtual event (e.g. video call).'],
  ] },
  { group: 'Human-made', items: [
    ['humanEdits', 'Human edits', 'Edited by a human using non-generative tools.'],
    ['minorHumanEdits', 'Minor human edits', 'Small human edits (deprecated in favour of humanEdits).'],
    ['digitalCreation', 'Digital creation', 'Created by a human using digital tools (formerly digitalArt).'],
    ['digitalArt', 'Digital art (legacy)', 'Older term for digitalCreation.'],
    ['dataDrivenMedia', 'Data-driven media', 'Generated from data, e.g. a chart or a weather map.'],
    ['algorithmicMedia', 'Algorithmic media', 'Produced by an algorithm not based on sampled training data.'],
    ['softwareImage', 'Software image (legacy)', ''],
  ] },
  { group: 'Composite', items: [
    ['composite', 'Composite', 'Mix of elements, at least one of which is synthetic or from another source.'],
    ['compositeCapture', 'Composite of captures', 'Composite of multiple captured elements.'],
    ['compositeSynthetic', 'Composite of synthetic elements', 'Composite that includes synthetic elements.'],
  ] },
  { group: 'AI', items: [
    ['trainedAlgorithmicMedia', 'Generative AI output', 'Created by a model trained on sampled content (text-to-image, etc.).'],
    ['compositeWithTrainedAlgorithmicMedia', 'Composite with generative AI', 'Mix of human/captured content with AI-generated elements (e.g. generative fill).'],
    ['algorithmicallyEnhanced', 'Algorithmically enhanced', 'Captured content modified by AI enhancement (e.g. upscaling, denoise).'],
  ] },
  { group: 'C2PA', items: [
    ['http://c2pa.org/digitalsourcetype/empty', 'Empty (C2PA)', 'No source content, e.g. a blank canvas.'],
    ['http://c2pa.org/digitalsourcetype/trainedAlgorithmicData', 'Trained algorithmic data (C2PA)', 'Non-media data produced by a trained model.'],
  ] },
];

export const SOURCE_TYPE_INDEX = Object.fromEntries(
  SOURCE_TYPES.flatMap((g) => g.items.map(([id, label, desc]) => [id.startsWith('http') ? id : IPTC + id, { label, desc, group: g.group }])));

export const ACTIONS = [
  ['c2pa.created', 'Created', 'A new asset was created. Must be the first action and carry a digitalSourceType.'],
  ['c2pa.opened', 'Opened', 'An existing asset (a parentOf ingredient) was opened for editing.'],
  ['c2pa.placed', 'Placed', 'A componentOf ingredient was added into the asset.'],
  ['c2pa.edited', 'Edited', 'Generic edit to the content.'],
  ['c2pa.edited.metadata', 'Edited metadata', 'Only metadata changed; the content is unchanged.'],
  ['c2pa.color_adjustments', 'Colour adjustments', 'Tone, contrast, saturation, white balance…'],
  ['c2pa.cropped', 'Cropped', ''],
  ['c2pa.resized', 'Resized', 'Dimensions changed without cropping.'],
  ['c2pa.orientation', 'Orientation', 'Rotated or flipped.'],
  ['c2pa.filtered', 'Filtered', 'A filter or effect was applied.'],
  ['c2pa.drawing', 'Drawing', 'Painting or drawing tools were used.'],
  ['c2pa.removed', 'Removed', 'Content was removed.'],
  ['c2pa.redacted', 'Redacted', 'An assertion was redacted. Needs a reason.'],
  ['c2pa.converted', 'Converted', 'Format changed (e.g. PNG to JPEG).'],
  ['c2pa.transcoded', 'Transcoded', 'Re-encoded without content change.'],
  ['c2pa.repackaged', 'Repackaged', 'Moved to a different container, no re-encoding.'],
  ['c2pa.translated', 'Translated', 'Language translation.'],
  ['c2pa.dubbed', 'Dubbed', 'Audio dubbed into another language.'],
  ['c2pa.watermarked', 'Watermarked', 'An invisible watermark was added.'],
  ['c2pa.published', 'Published', 'Distributed or published.'],
  ['c2pa.unknown', 'Unknown', 'Something happened that can\'t be described further.'],
];
export const ACTION_INDEX = Object.fromEntries(ACTIONS.map(([id, label, desc]) => [id, { label, desc }]));

export const REDACT_REASONS = ['c2pa.PII.present', 'c2pa.invalid.data', 'c2pa.trade-secret.present', 'c2pa.government.confidential'];

export const NAMESPACES = {
  dc: 'http://purl.org/dc/elements/1.1/',
  dcterms: 'http://purl.org/dc/terms/',
  xmp: 'http://ns.adobe.com/xap/1.0/',
  xmpRights: 'http://ns.adobe.com/xap/1.0/rights/',
  photoshop: 'http://ns.adobe.com/photoshop/1.0/',
  Iptc4xmpCore: 'http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/',
  Iptc4xmpExt: 'http://iptc.org/std/Iptc4xmpExt/2008-02-29/',
  exif: 'http://ns.adobe.com/exif/1.0/',
  exifEX: 'http://cipa.jp/exif/1.0/',
  tiff: 'http://ns.adobe.com/tiff/1.0/',
  plus: 'http://ns.useplus.org/ldf/xmp/1.0/',
};

// type: text | list | bool | date
export const METADATA_FIELDS = [
  ['dc:creator', 'Creator(s)', 'list'],
  ['dc:title', 'Title', 'text'],
  ['dc:description', 'Description / caption', 'text'],
  ['dc:subject', 'Keywords', 'list'],
  ['dc:rights', 'Copyright notice', 'text'],
  ['dc:publisher', 'Publisher', 'list'],
  ['dc:language', 'Language', 'list'],
  ['xmp:CreateDate', 'Create date', 'date'],
  ['xmp:CreatorTool', 'Creator tool', 'text'],
  ['xmp:Rating', 'Rating', 'text'],
  ['xmpRights:WebStatement', 'Rights web statement (URL)', 'text'],
  ['xmpRights:UsageTerms', 'Usage terms', 'text'],
  ['xmpRights:Marked', 'Rights-managed', 'bool'],
  ['photoshop:Headline', 'Headline', 'text'],
  ['photoshop:Credit', 'Credit line', 'text'],
  ['photoshop:Source', 'Source', 'text'],
  ['photoshop:DateCreated', 'Date created', 'date'],
  ['photoshop:City', 'City', 'text'],
  ['photoshop:State', 'State / province', 'text'],
  ['photoshop:Country', 'Country', 'text'],
  ['photoshop:Instructions', 'Special instructions', 'text'],
  ['Iptc4xmpCore:Location', 'Sublocation', 'text'],
  ['Iptc4xmpCore:CountryCode', 'Country code', 'text'],
  ['Iptc4xmpCore:Scene', 'Scene codes', 'list'],
  ['Iptc4xmpExt:PersonInImage', 'Person shown', 'list'],
  ['Iptc4xmpExt:Event', 'Event', 'text'],
  ['Iptc4xmpExt:DigitalSourceType', 'Digital source type', 'text'],
  ['exif:DateTimeOriginal', 'Date/time original', 'date'],
  ['exif:GPSLatitude', 'GPS latitude', 'text'],
  ['exif:GPSLongitude', 'GPS longitude', 'text'],
  ['tiff:Make', 'Camera make', 'text'],
  ['tiff:Model', 'Camera model', 'text'],
];
export const METADATA_INDEX = Object.fromEntries(METADATA_FIELDS.map(([k, label, type]) => [k, { label, type }]));

export const SCHEMA_FIELDS = [
  ['author', 'Author', 'json'],
  ['name', 'Name', 'text'],
  ['description', 'Description', 'text'],
  ['url', 'URL', 'text'],
  ['dateCreated', 'Date created', 'date'],
  ['copyrightHolder', 'Copyright holder', 'text'],
  ['copyrightYear', 'Copyright year', 'text'],
  ['license', 'License URL', 'text'],
  ['keywords', 'Keywords', 'list'],
];
export const SCHEMA_INDEX = Object.fromEntries(SCHEMA_FIELDS.map(([k, label, type]) => [k, { label, type }]));

export const TRAINING_ENTRIES = [
  ['cawg.ai_generative_training', 'Generative AI training', 'Training models that generate content.'],
  ['cawg.ai_training', 'AI training', 'Training any other machine-learning model.'],
  ['cawg.ai_inference', 'AI inference', 'Using the asset as input to a trained model (e.g. captioning, RAG).'],
  ['cawg.data_mining', 'Data mining', 'Text and data mining for patterns or insights.'],
];
export const TRAINING_USES = [['allowed', 'Allowed'], ['notAllowed', 'Not allowed'], ['constrained', 'Constrained']];

export const CAWG_ROLES = [
  ['cawg.creator', 'Creator'], ['cawg.contributor', 'Contributor'], ['cawg.editor', 'Editor'],
  ['cawg.producer', 'Producer'], ['cawg.publisher', 'Publisher'], ['cawg.sponsor', 'Sponsor'],
  ['cawg.translator', 'Translator'],
];

export const TSA_PRESETS = [
  ['', 'No timestamp'],
  ['http://timestamp.digicert.com', 'DigiCert'],
  ['http://timestamp.sectigo.com', 'Sectigo'],
  ['http://ts.ssl.com', 'SSL.com'],
];

// Assertion kinds the editor has dedicated forms for.
export const KINDS = {
  actions: { title: 'Actions', icon: 'layers', blurb: 'What happened to the asset, in order.' },
  metadata: { title: 'CAWG metadata', icon: 'file', blurb: 'Descriptive metadata as JSON-LD (Dublin Core, IPTC, XMP, EXIF).' },
  training: { title: 'Training & data mining', icon: 'shield', blurb: 'Whether the asset may be used for AI training, inference, or mining.' },
  creativework: { title: 'Schema.org CreativeWork', icon: 'pen', blurb: 'Legacy authorship assertion (deprecated in C2PA 2.x).' },
  custom: { title: 'Custom assertion', icon: 'code', blurb: 'Any label and JSON payload.' },
};

export function kindOf(label = '') {
  if (/^c2pa\.actions(\.v\d+)?$/.test(label)) return 'actions';
  if (label === 'cawg.metadata') return 'metadata';
  if (/^(cawg|c2pa)\.training-mining$/.test(label)) return 'training';
  if (label === 'stds.schema-org.CreativeWork') return 'creativework';
  return 'custom';
}

export const ASSERTION_TEMPLATES = {
  actions: () => ({ label: 'c2pa.actions.v2', data: { actions: [{ action: 'c2pa.created', digitalSourceType: IPTC + 'digitalCapture' }] } }),
  metadata: () => ({ label: 'cawg.metadata', data: { '@context': { dc: NAMESPACES.dc }, 'dc:creator': [], 'dc:title': '{{basename}}' } }),
  training: () => ({ label: 'cawg.training-mining', data: { entries: Object.fromEntries(TRAINING_ENTRIES.map(([k]) => [k, { use: 'notAllowed' }])) } }),
  creativework: () => ({ label: 'stds.schema-org.CreativeWork', data: { '@context': 'https://schema.org', '@type': 'CreativeWork', author: [{ '@type': 'Person', name: '' }] } }),
  custom: () => ({ label: 'com.example.custom', data: { note: 'Your payload here' } }),
};

export const BLANK_PROFILE = () => ({
  name: 'Untitled profile',
  description: '',
  color: '#2F6FB0',
  tags: [],
  signing: { certSet: 'vectorline-c2pa', tsaUrl: '', cawg: { enabled: false, certSet: 'vectorline-cawg', roles: ['cawg.creator'], referencedAssertions: ['c2pa.actions.v2'] } },
  manifest: {
    claim_generator_info: [{ name: 'Vectorline C2PA Studio', version: '0.1.0' }],
    title: '{{filename}}',
    assertions: [ASSERTION_TEMPLATES.actions()],
  },
});

export const PROFILE_COLORS = ['#2F6FB0', '#1F4E7A', '#7A4FB0', '#A0558F', '#B08D57', '#C0603A', '#2E8B6F', '#636A76'];

// Labels the SDK writes itself; they're dropped when importing a manifest as a profile.
export const AUTO_LABELS = /^(c2pa\.hash\.|c2pa\.thumbnail\.|c2pa\.ingredient|cawg\.identity|c2pa\.soft-binding|c2pa\.time-stamp|c2pa\.certificate-status)/;
