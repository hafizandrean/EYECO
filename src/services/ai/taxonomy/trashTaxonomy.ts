/**
 * EYECO AI Engine v3.0 — Trash Taxonomy & Class Category Mapping
 * Defines 6 MVP Core Classes & Multi-Category Mappings for COCO/YOLO Detections.
 *
 * Uses word-boundary matching: class label is split into individual words
 * to prevent false positives (e.g. 'handbag' should NOT match 'bag').
 */

export interface TrashCategoryInfo {
  id: string;
  label: string;
  categoryGroup: 'Plastik' | 'Kertas' | 'Logam' | 'Kaca' | 'Organik' | 'Medis' | 'Elektronik' | 'Sampah Umum' | 'Lainnya';
  isMvpClass: boolean;
}

// 6 Core MVP Classes
export const MVP_TRASH_CLASSES: Record<string, TrashCategoryInfo> = {
  plastic_bottle: { id: 'plastic_bottle', label: 'Plastic Bottle', categoryGroup: 'Plastik', isMvpClass: true },
  plastic_bag: { id: 'plastic_bag', label: 'Plastic Bag', categoryGroup: 'Plastik', isMvpClass: true },
  food_wrapper: { id: 'food_wrapper', label: 'Food Wrapper', categoryGroup: 'Plastik', isMvpClass: true },
  cup: { id: 'cup', label: 'Cup', categoryGroup: 'Plastik', isMvpClass: true },
  can: { id: 'can', label: 'Can', categoryGroup: 'Logam', isMvpClass: true },
  paper: { id: 'paper', label: 'Paper', categoryGroup: 'Kertas', isMvpClass: true },
};

// Full Taxonomy Classification Schema (group reference)
export const TRASH_TAXONOMY_GROUPS = {
  Plastik: [
    'plastic_bottle', 'plastic_cup', 'plastic_bag', 'plastic_wrapper', 'food_wrapper',
    'plastic_container', 'straw', 'bottle', 'cup', 'skis', 'sports ball', 'skateboard',
  ],
  Kertas: [
    'paper', 'cardboard', 'newspaper', 'paper_cup', 'carton', 'box', 'pack',
  ],
  Logam: [
    'can', 'metal_container', 'tin',
  ],
  Kaca: [
    'glass_bottle', 'broken_glass', 'glass',
  ],
  Organik: [
    'food_waste', 'fruit_peel', 'leaves', 'banana', 'apple', 'orange',
  ],
  Medis: [
    'mask', 'gloves', 'syringe',
  ],
  Elektronik: [
    'battery', 'phone', 'cable', 'cell phone', 'electronic',
  ],
};

// ── Helpers ────────────────────────────────────────────────────────────────

/** Split class label into individual words (space / underscore / dash separated) */
function words(cls: string): string[] {
  return cls.toLowerCase().trim().split(/[\s_-]+/).filter(Boolean);
}

// ── isTrashClass ───────────────────────────────────────────────────────────

/**
 * COCO classes that are DEFINITELY NOT trash.
 * Person/people variants, vehicles, animals, furniture, electronics, road/river.
 */
const SAFE_CLASSES = new Set([
  // Person variants
  'person', 'orang', 'people', 'sitting', 'standing',
  'fall-detected', 'fall detected',
  // Accessories (not trash themselves)
  'handbag', 'backpack', 'suitcase',
  // Vehicles
  'bicycle', 'car', 'motorcycle', 'bus', 'truck', 'boat', 'train', 'airplane',
  // Animals
  'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe',
  // Furniture & environment
  'chair', 'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv',
  'bench', 'parking meter', 'stop sign', 'fire hydrant', 'traffic light',
  // Electronics & office
  'laptop', 'mouse', 'remote', 'keyboard', 'clock', 'cell phone',
  'book', 'umbrella', 'tie', 'scissors', 'teddy bear',
  // Sports equipment
  'frisbee', 'snowboard', 'surfboard', 'tennis racket', 'sports ball',
  'baseball bat', 'baseball glove', 'skateboard',
  // Personal care
  'hair drier', 'toothbrush',
  'river', 'sungai', 'road', 'jalan',
  // Vehicles — bukan sampah
  'motorcycle', 'motorbike', 'bicycle', 'bike', 'car', 'truck', 'bus', 'train', 'boat',
]);

/**
 * Trash-indicating keywords (word-boundary matched).
 * A class label is trash if ANY of its individual words is in this set.
 */
const TRASH_KEYWORDS = new Set([
  'trash', 'sampah', 'littering', 'waste', 'litter', 'garbage', 'rubbish', 'trash_can', 'dustbin',
  'bottle', 'bag', 'wrapper', 'pack', 'cup', 'bowl', 'vase',
  'can', 'tin', 'paper', 'cardboard', 'carton', 'box',
  'straw', 'container', 'mask', 'gloves', 'glove',
  'skis', 'glass', 'foam', 'styrofoam',
  'disposable', 'aluminium', 'blister',
  'cigarette', 'battery', 'scrap', 'tissues',
  'tub', 'tube', 'ring', 'lid',
  'utensil', 'film', 'pop', 'rope', 'string',
]);

/** Check if a raw class label represents a trash object (word-boundary matching) */
export function isTrashClass(rawClass: string): boolean {
  if (!rawClass) return false;
  const cls = rawClass.toLowerCase().trim();

  // Fast-path: exact match on safe classes
  if (SAFE_CLASSES.has(cls)) return false;

  // Word-boundary match against trash keywords
  const clsWords = words(cls);
  return clsWords.some(w => TRASH_KEYWORDS.has(w));
}

// ── mapToTrashTaxonomy ─────────────────────────────────────────────────────

/** Map raw YOLO/COCO class label to canonical EYECO Trash Taxonomy Info */
export function mapToTrashTaxonomy(rawClass: string): TrashCategoryInfo {
  const clsWords = words(rawClass);
  const rawLower = rawClass.toLowerCase().trim();

  // Mapping rules — first match wins, ordered by specificity
  // Check raw string (before word split) for compound keywords
  if (/(trash_pile|tumpukan|timbunan|gunungan)/i.test(rawClass)) {
    return { id: 'trash_pile', label: 'Tumpukan Sampah', categoryGroup: 'Sampah Umum', isMvpClass: true };
  }
  if (clsWords.includes('food') && clsWords.includes('waste')) {
    return { id: 'food_waste', label: 'Food Waste', categoryGroup: 'Organik', isMvpClass: true };
  }
  if (clsWords.some(w => ['trash', 'sampah', 'rubbish', 'litter'].includes(w))) {
    return { id: 'trash', label: 'Trash', categoryGroup: 'Sampah Umum', isMvpClass: true };
  }
  if (clsWords.includes('bottle')) {
    return { id: 'plastic_bottle', label: 'Plastic Bottle', categoryGroup: 'Plastik', isMvpClass: true };
  }
  if (clsWords.includes('bag') || clsWords.includes('suitcase')) {
    return { id: 'plastic_bag', label: 'Plastic Bag', categoryGroup: 'Plastik', isMvpClass: true };
  }
  if (clsWords.includes('wrapper') || clsWords.includes('pack') || clsWords.includes('skis') || clsWords.includes('skateboard')) {
    return { id: 'food_wrapper', label: 'Food Wrapper', categoryGroup: 'Plastik', isMvpClass: true };
  }
  if (clsWords.includes('cup') || clsWords.includes('bowl') || clsWords.includes('vase')) {
    return { id: 'cup', label: 'Cup', categoryGroup: 'Plastik', isMvpClass: true };
  }
  if (clsWords.includes('can') || clsWords.includes('tin')) {
    return { id: 'can', label: 'Can', categoryGroup: 'Logam', isMvpClass: true };
  }
  if (clsWords.includes('paper') || clsWords.includes('cardboard') || clsWords.includes('carton') || clsWords.includes('box')) {
    return { id: 'paper', label: 'Paper', categoryGroup: 'Kertas', isMvpClass: true };
  }
  if (clsWords.includes('mask') || clsWords.includes('glove')) {
    return { id: 'mask', label: 'Medical Trash', categoryGroup: 'Medis', isMvpClass: false };
  }
  if (clsWords.includes('phone') || clsWords.includes('battery') || clsWords.includes('cable') || clsWords.includes('electronic')) {
    return { id: 'electronic', label: 'Electronic Trash', categoryGroup: 'Elektronik', isMvpClass: false };
  }
  if (clsWords.includes('glass')) {
    return { id: 'glass_bottle', label: 'Glass', categoryGroup: 'Kaca', isMvpClass: false };
  }

  // Default fallback for general trash
  return { id: 'food_wrapper', label: 'Food Wrapper', categoryGroup: 'Plastik', isMvpClass: true };
}