import { GARMENT_PICTURES, pictureSrc } from '@/lib/localFirst/garmentPictures';

interface Props {
  /** The chosen picture key, or null for none (the counter then shows the first letter of the name). */
  value: string | null;
  onChange: (key: string | null) => void;
}

/** The bundled garment pictures as a grid of choices, for a garment the administrator adds. */
export const PicturePicker = ({ value, onChange }: Props) => (
  <fieldset className="counter-picture-picker">
    <legend>Picture</legend>
    <label className={value === null ? 'selected' : ''}>
      <input type="radio" name="garment-picture" checked={value === null} onChange={() => onChange(null)} />
      <span className="counter-picture-none" aria-hidden="true" />
      <span>No picture</span>
    </label>
    {GARMENT_PICTURES.map(picture => (
      <label key={picture.key} className={value === picture.key ? 'selected' : ''}>
        <input type="radio" name="garment-picture" checked={value === picture.key} onChange={() => onChange(picture.key)} />
        <img src={pictureSrc(picture.key)} alt="" />
        <span>{picture.label}</span>
      </label>
    ))}
  </fieldset>
);
