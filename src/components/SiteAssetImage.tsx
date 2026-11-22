import type { CSSProperties } from 'react';
import type { SiteAssetConfig } from '../types';

interface SiteAssetImageProps {
  slotKey: string;
  siteAssets?: SiteAssetConfig[];
  fallbackUrl: string;
  fallbackAlt?: string;
  className?: string;
  style?: CSSProperties;
  referrerPolicy?: React.HTMLAttributeReferrerPolicy;
}

export function findSiteAsset(siteAssets: SiteAssetConfig[] | undefined, slotKey: string): SiteAssetConfig | undefined {
  return siteAssets?.find((a) => a.slot_key === slotKey);
}

export function SiteAssetImage({
  slotKey,
  siteAssets,
  fallbackUrl,
  fallbackAlt = 'Visual Ganesha Circle',
  className = '',
  style,
  referrerPolicy = 'no-referrer',
}: SiteAssetImageProps) {
  const asset = findSiteAsset(siteAssets, slotKey);
  const desktopSrc = asset?.desktop_url || fallbackUrl;
  const mobileSrc = asset?.mobile_url?.trim() || '';
  const alt = asset?.alt_text || fallbackAlt;

  const objectFit = asset?.object_fit || 'cover';
  const objectPosition = asset?.object_position || 'center';

  const mergedStyle: CSSProperties = {
    objectFit,
    objectPosition,
    ...style,
  };

  if (!desktopSrc) return null;

  return (
    <picture className="contents">
      {mobileSrc && <source media="(max-width: 767px)" srcSet={mobileSrc} />}
      <img
        src={desktopSrc}
        alt={alt}
        referrerPolicy={referrerPolicy}
        className={className}
        style={mergedStyle}
      />
    </picture>
  );
}
