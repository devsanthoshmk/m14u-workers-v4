export function BrandLogo({ className, artwork = false, alt = '' }: {
    className?: string;
    artwork?: boolean;
    alt?: string;
}) {
    const asset = artwork ? 'logo.webp' : 'mark.png';
    return <img src={`${import.meta.env.BASE_URL}branding/${asset}`} width={artwork ? 512 : 192} height={artwork ? 512 : 192} className={className} alt={alt} />;
}
