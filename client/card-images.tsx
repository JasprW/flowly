import { memo, useState } from "react";
import { Image, Pressable, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as rpc from "../shared/rpc";
import type { CardImage } from "../shared/model";
import { Modal } from "./modal";
import { Button, IconButton, Label, Notice, Theme, font, message, noFocusRing, radius, space, useTheme } from "./ui";
import { invalidateCardViews } from "./card-detail-query";
import { t } from "../shared/i18n";

/** Thumbnail edge in the sidebar (CARD-IMAGES-SPEC §4.1). */
export const cardThumbSize = 64;

/** One image's bytes, read once per id and size; ids never change content. */
export function cardImageKey(taskId: string, id: string, size: "thumb" | "full") {
  return ["flowly", "card-image", taskId, id, size] as const;
}

function useCardImage(taskId: string, id: string, size: "thumb" | "full", enabled: boolean) {
  const read = useRpc(rpc.readCardImage);
  return useQuery({
    queryKey: cardImageKey(taskId, id, size),
    queryFn: () => read({ taskId, id, size }),
    enabled,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: false,
  });
}

const Thumb = memo(function Thumb({ taskId, image, visible, onOpen }: { taskId: string; image: CardImage; visible: boolean; onOpen(id: string): void }) {
  const { colors } = useTheme();
  const data = useCardImage(taskId, image.id, "thumb", visible);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={image.name}
      onPress={() => onOpen(image.id)}
      style={{
        ...noFocusRing,
        width: cardThumbSize,
        height: cardThumbSize,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface2,
        overflow: "hidden",
      }}
    >
      {!!data.data && <Image source={{ uri: data.data.dataUri }} resizeMode="cover" style={{ width: cardThumbSize, height: cardThumbSize }} />}
    </Pressable>
  );
});

/**
 * The card's description images under its text (CARD-IMAGES-SPEC §4.1).
 * Thumbnails load only while `visible`; the full image only in the viewer.
 */
export const CardImageRow = memo(function CardImageRow({
  taskId,
  revision,
  images,
  visible,
  disabled,
}: {
  taskId: string;
  revision: number;
  images: readonly CardImage[];
  visible: boolean;
  /** Archived cards: view only. */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!images.length) return null;
  const current = open ? images.find((i) => i.id === open) : undefined;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
      {images.map((image) => (
        <Thumb key={image.id} taskId={taskId} image={image} visible={visible} onOpen={setOpen} />
      ))}
      {current && (
        <CardImageViewer
          taskId={taskId}
          revision={revision}
          images={images}
          image={current}
          disabled={disabled}
          onShow={setOpen}
          onClose={() => setOpen(null)}
        />
      )}
    </View>
  );
});

function CardImageViewer({
  taskId,
  revision,
  images,
  image,
  disabled,
  onShow,
  onClose,
}: {
  taskId: string;
  revision: number;
  images: readonly CardImage[];
  image: CardImage;
  disabled?: boolean;
  onShow(id: string): void;
  onClose(): void;
}) {
  const theme = useTheme();
  const toast = useToast();
  const client = useQueryClient();
  const remove = useRpc(rpc.removeCardImage);
  const [pending, setPending] = useState(false);
  const full = useCardImage(taskId, image.id, "full", true);
  const index = images.findIndex((i) => i.id === image.id);
  const step = (by: number) => onShow(images[(index + by + images.length) % images.length].id);
  const drop = async () => {
    setPending(true);
    try {
      await remove({ taskId, expectedRevision: revision, id: image.id });
      client.removeQueries({ queryKey: ["flowly", "card-image", taskId, image.id] });
      await invalidateCardViews(client);
      onClose();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal open title={image.name} onOpenChange={(next) => !next && onClose()}>
      <Modal.Content>
        <Theme.Provider value={theme}>
          <View style={{ gap: space[3] }}>
            {full.error ? (
              <Notice tone="warning">{message(full.error)}</Notice>
            ) : full.data ? (
              <Image source={{ uri: full.data.dataUri }} resizeMode="contain" accessibilityLabel={image.name} style={{ width: "100%", height: 480 }} />
            ) : (
              <View style={{ height: 480, alignItems: "center", justifyContent: "center" }}>
                <Label muted>{t("Loading…")}</Label>
              </View>
            )}
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
              {images.length > 1 && (
                <>
                  <IconButton icon="ChevronLeft" label={t("Previous image")} onPress={() => step(-1)} />
                  <Label muted size={font.sm}>{`${index + 1} / ${images.length}`}</Label>
                  <IconButton icon="ChevronRight" label={t("Next image")} onPress={() => step(1)} />
                </>
              )}
              <View style={{ flex: 1 }} />
              <Button quiet icon="Trash2" disabled={disabled || pending} onPress={() => void drop()}>
                {t("Remove")}
              </Button>
            </View>
          </View>
        </Theme.Provider>
      </Modal.Content>
    </Modal>
  );
}
