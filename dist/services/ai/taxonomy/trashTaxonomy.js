"use strict";
/**
 * EYECO AI Engine v3.0 — Trash Taxonomy & Class Category Mapping
 * Defines 6 MVP Core Classes & Multi-Category Mappings for COCO/YOLO Detections.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRASH_TAXONOMY_GROUPS = exports.MVP_TRASH_CLASSES = void 0;
exports.isTrashClass = isTrashClass;
exports.mapToTrashTaxonomy = mapToTrashTaxonomy;
// 6 Core MVP Classes (as specified in user requirements)
exports.MVP_TRASH_CLASSES = {
    plastic_bottle: { id: 'plastic_bottle', label: 'Plastic Bottle', categoryGroup: 'Plastik', isMvpClass: true },
    plastic_bag: { id: 'plastic_bag', label: 'Plastic Bag', categoryGroup: 'Plastik', isMvpClass: true },
    food_wrapper: { id: 'food_wrapper', label: 'Food Wrapper', categoryGroup: 'Plastik', isMvpClass: true },
    cup: { id: 'cup', label: 'Cup', categoryGroup: 'Plastik', isMvpClass: true },
    can: { id: 'can', label: 'Can', categoryGroup: 'Logam', isMvpClass: true },
    paper: { id: 'paper', label: 'Paper', categoryGroup: 'Kertas', isMvpClass: true },
};
// Full Taxonomy Classification Schema
exports.TRASH_TAXONOMY_GROUPS = {
    Plastik: [
        'plastic_bottle', 'plastic_cup', 'plastic_bag', 'plastic_wrapper', 'food_wrapper',
        'plastic_container', 'straw', 'bottle', 'cup', 'skis', 'sports ball', 'skateboard'
    ],
    Kertas: [
        'paper', 'cardboard', 'newspaper', 'paper_cup', 'carton', 'box', 'pack'
    ],
    Logam: [
        'can', 'metal_container', 'tin'
    ],
    Kaca: [
        'glass_bottle', 'broken_glass', 'glass'
    ],
    Organik: [
        'food_waste', 'fruit_peel', 'leaves', 'banana', 'apple', 'orange'
    ],
    Medis: [
        'mask', 'gloves', 'syringe'
    ],
    Elektronik: [
        'battery', 'phone', 'cable', 'cell phone', 'electronic'
    ]
};
// List of all class keywords recognized as trash (including COCO ground/litter misclassifications)
const ALL_TRASH_KEYWORDS = [
    'trash', 'sampah', 'littering', 'waste', 'litter',
    'bottle', 'plastic_bottle', 'glass_bottle',
    'bag', 'plastic_bag', 'handbag', 'backpack', 'suitcase',
    'wrapper', 'food_wrapper', 'plastic_wrapper',
    'cup', 'plastic_cup', 'paper_cup',
    'can', 'tin',
    'paper', 'cardboard', 'carton', 'box', 'pack',
    'straw', 'container', 'mask', 'gloves',
    'skis', 'sports ball', 'skateboard', 'bowl', 'vase'
];
/**
 * Check if a raw class label represents a trash object
 */
function isTrashClass(rawClass) {
    if (!rawClass)
        return false;
    const cls = rawClass.toLowerCase().trim();
    if (cls === 'person' || cls === 'orang' || cls === 'river' || cls === 'sungai' || cls === 'road' || cls === 'jalan') {
        return false;
    }
    return ALL_TRASH_KEYWORDS.some(keyword => cls.includes(keyword));
}
/**
 * Map raw YOLO/COCO class label to canonical EYECO Trash Taxonomy Info
 */
function mapToTrashTaxonomy(rawClass) {
    const cls = (rawClass || '').toLowerCase().trim();
    if (cls.includes('bottle')) {
        return { id: 'plastic_bottle', label: 'Plastic Bottle', categoryGroup: 'Plastik', isMvpClass: true };
    }
    if (cls.includes('bag') || cls.includes('suitcase')) {
        return { id: 'plastic_bag', label: 'Plastic Bag', categoryGroup: 'Plastik', isMvpClass: true };
    }
    if (cls.includes('wrapper') || cls.includes('pack') || cls.includes('skis') || cls.includes('sports ball') || cls.includes('skateboard')) {
        return { id: 'food_wrapper', label: 'Food Wrapper', categoryGroup: 'Plastik', isMvpClass: true };
    }
    if (cls.includes('cup') || cls.includes('bowl') || cls.includes('vase')) {
        return { id: 'cup', label: 'Cup', categoryGroup: 'Plastik', isMvpClass: true };
    }
    if (cls.includes('can') || cls.includes('tin')) {
        return { id: 'can', label: 'Can', categoryGroup: 'Logam', isMvpClass: true };
    }
    if (cls.includes('paper') || cls.includes('cardboard') || cls.includes('carton') || cls.includes('box')) {
        return { id: 'paper', label: 'Paper', categoryGroup: 'Kertas', isMvpClass: true };
    }
    if (cls.includes('mask') || cls.includes('glove') || cls.includes('syringe')) {
        return { id: 'mask', label: 'Medical Trash', categoryGroup: 'Medis', isMvpClass: false };
    }
    if (cls.includes('phone') || cls.includes('battery') || cls.includes('cable')) {
        return { id: 'electronic', label: 'Electronic Trash', categoryGroup: 'Elektronik', isMvpClass: false };
    }
    // Default fallback for general trash
    return { id: 'food_wrapper', label: 'Food Wrapper', categoryGroup: 'Plastik', isMvpClass: true };
}
