import { useEffect, useState } from 'react';
import type { CarouselApi } from '../components/ui/carousel.js';
import type { Recording } from '../types.js';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '../components/ui/carousel.js';
import { Badge } from '../components/ui/badge.js';
import { cn } from '../lib/utils.js';

/** Cut images labelled with their offset from the recording start. */
export function cutImages(recording: Recording, withTags = false) {
  const startedAt = Date.parse(recording.startedAt);
  return recording.cuts.map((cut) => ({
    id: cut.cutId,
    label: [
      `Cut ${cut.number}`,
      `${(Math.max(0, Date.parse(cut.timestamp) - startedAt) / 1000).toFixed(1)}s`,
      withTags ? cut.tags.join(' + ') : '',
    ]
      .filter(Boolean)
      .join(' · '),
  }));
}

/** Shows one cut at a time, with a thumbnail strip for every captured image. */
export function CutCarousel({
  apiUrl,
  images,
}: {
  apiUrl: string;
  images: { id: string; label: string }[];
}) {
  const [api, setApi] = useState<CarouselApi>();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!api) return;
    const update = () => setIndex(api.selectedScrollSnap());
    update();
    api.on('select', update);
    api.on('reInit', update);
    return () => {
      api.off('select', update);
      api.off('reInit', update);
    };
  }, [api]);

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <Carousel
        setApi={setApi}
        className={images.length > 1 ? 'w-full px-10' : 'w-full'}
        opts={{ align: 'center' }}
      >
        <CarouselContent className="ml-0">
          {images.map((image) => (
            <CarouselItem key={image.id} className="pl-0">
              <img
                src={`${apiUrl}/image/${image.id}`}
                alt={image.label}
                className="mx-auto max-h-[min(52vh,420px)] w-auto max-w-full rounded-xl border bg-muted object-contain shadow-sm"
              />
            </CarouselItem>
          ))}
        </CarouselContent>
        {images.length > 1 && (
          <>
            <CarouselPrevious aria-label="Previous cut" className="left-0 bg-background/80 backdrop-blur" />
            <CarouselNext aria-label="Next cut" className="right-0 bg-background/80 backdrop-blur" />
          </>
        )}
      </Carousel>

      <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-muted-foreground">
        <Badge variant="secondary" data-testid="cut-position" aria-label="Cut position">
          {index + 1} / {images.length}
        </Badge>
        <span data-testid="cut-label">{images[index]?.label}</span>
      </div>

      {images.length > 1 && (
        <div role="group" aria-label="Cuts" className="flex flex-wrap justify-center gap-1.5">
          {images.map((image, position) => (
            <button
              key={image.id}
              type="button"
              aria-label={`Show ${image.label}`}
              aria-current={position === index ? 'true' : undefined}
              onClick={() => api?.scrollTo(position)}
              className={cn(
                'h-10 w-14 shrink-0 overflow-hidden rounded border bg-muted',
                position === index && 'border-primary ring-2 ring-primary/40',
              )}
            >
              <img src={`${apiUrl}/image/${image.id}`} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
