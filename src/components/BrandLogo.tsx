export function BrandLogo({ className, artwork = false, alt = '' }: {
    className?: string;
    artwork?: boolean;
    alt?: string;
}) {
    const asset = artwork ? 'logo.svg' : 'mark.svg';
    const size = artwork ? 512 : 192;
    return <img src={`${import.meta.env.BASE_URL}branding/${asset}`} width={size} height={size} className={className} alt={alt} />;
}
