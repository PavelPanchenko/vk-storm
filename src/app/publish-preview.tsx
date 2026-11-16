import Image from "next/image";

export function PublishPreview({ post }: {
  post?: { text: string; images: string[]; videos: string[] };
}) {
  if (!post) return null;
  return (
    <div className="publish-preview">
      {post.text && <p>{post.text}</p>}
      {(post.images.length > 0 || post.videos.length > 0) && (
        <div className="publish-preview-media">
          {post.images.map((src, index) => <Image key={`${src}-${index}`} src={src} alt={`Фото ${index + 1}`} width={88} height={88} unoptimized />)}
          {post.videos.map((src, index) => <video key={`${src}-${index}`} src={src} aria-label={`Видео ${index + 1}`} controls preload="metadata" />)}
        </div>
      )}
    </div>
  );
}
