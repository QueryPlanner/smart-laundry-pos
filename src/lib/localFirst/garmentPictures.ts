/**
 * The garment pictures bundled with the app (`public/garments/<key>-transparent.png`), for the
 * administrator to choose from when adding a garment. The guard test checks every file exists and
 * that every bundled picture is listed here.
 */
export interface GarmentPicture { key: string; label: string }

export const GARMENT_PICTURES: GarmentPicture[] = [
  { key: 'shirt', label: 'Shirt' },
  { key: 'tshirt', label: 'T-shirt' },
  { key: 'jeans', label: 'Jeans' },
  { key: 'trousers', label: 'Trousers' },
  { key: 'shorts', label: 'Shorts' },
  { key: 'suit', label: 'Suit (2 piece)' },
  { key: 'coat', label: 'Coat / Blazer' },
  { key: 'jacket', label: 'Jacket' },
  { key: 'nehru-jacket', label: 'Nehru jacket' },
  { key: 'sweater', label: 'Sweater' },
  { key: 'shawl', label: 'Shawl' },
  { key: 'kurta', label: 'Kurta / kameez' },
  { key: 'kurta-pyjama', label: 'Kurta pyjama' },
  { key: 'sherwani', label: 'Sherwani' },
  { key: 'pyjama', label: 'Pyjama' },
  { key: 'dhoti', label: 'Dhoti' },
  { key: 'lungi', label: 'Lungi' },
  { key: 'saree', label: 'Saree' },
  { key: 'blouse', label: 'Blouse' },
  { key: 'petticoat', label: 'Petticoat / parkar' },
  { key: 'churidar', label: 'Churidar suit' },
  { key: 'salwar', label: 'Salwar / churidar' },
  { key: 'kurti', label: 'Kurti' },
  { key: 'anarkali', label: 'Anarkali' },
  { key: 'palazzo', label: 'Palazzo' },
  { key: 'leggings', label: 'Leggings' },
  { key: 'dupatta', label: 'Dupatta' },
  { key: 'lehenga', label: 'Lehenga' },
  { key: 'gown', label: 'Gown' },
  { key: 'dress', label: 'Dress / frock' },
  { key: 'uniform', label: 'School uniform' },
  { key: 'baby-clothes', label: 'Baby clothes' },
  { key: 'shoes', label: 'Shoes' },
  { key: 'bedsheet-single', label: 'Single bedsheet' },
  { key: 'bedsheet-double', label: 'Double bedsheet' },
  { key: 'pillow-cover', label: 'Pillow covers' },
  { key: 'blanket-single', label: 'Single blanket' },
  { key: 'blanket-double', label: 'Double blanket' },
  { key: 'quilt', label: 'Quilt / razai' },
  { key: 'curtain', label: 'Curtains' },
  { key: 'sofa-cover', label: 'Sofa / cushion covers' },
  { key: 'table-cloth', label: 'Table cloth' },
  { key: 'towel', label: 'Towels' },
  { key: 'footmat', label: 'Footmat' },
];

/** Where the counter loads a picture from. */
export const pictureSrc = (key: string): string => `/garments/${key}-transparent.png`;
