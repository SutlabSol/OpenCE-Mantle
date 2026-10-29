import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseCacheFileHeader,
  parseTagIndex,
  inspectMapHudAndUiTargets,
  applyLiveHudEdit,
  applyLiveWeaponStatEdit,
  injectHudElementBitmap,
  inspectUiWidgetCanvas,
  updateUiWidgetPlacement,
  saveUnicodeStringListTable,
  encodeRgbaToPng,
} from '../src/index';

const SAMPLE_MAPS_DIR = path.resolve(__dirname, '../../sample_maps');
const BG_PATH = path.join(SAMPLE_MAPS_DIR, 'bloodgulch.map');
const UI_PATH = path.join(SAMPLE_MAPS_DIR, 'ui.map');

describe('core/src/map/live-hud-editor', () => {
  it.skipIf(!fs.existsSync(BG_PATH))(
    'inspects weapons, vehicles, unit HUDs, global HUDs, and weapon stats in bloodgulch.map',
    () => {
      const buf = fs.readFileSync(BG_PATH);
      const header = parseCacheFileHeader(buf);
      const tagIndex = parseTagIndex(buf, header);

      const catalog = inspectMapHudAndUiTargets(buf, header, tagIndex);
      expect(catalog.mapName).toBe('bloodgulch');
      expect(catalog.weapons.length).toBeGreaterThan(5);
      expect(catalog.vehicles.length).toBeGreaterThan(2);
      expect(catalog.unitHuds.length).toBeGreaterThan(0);
      expect(catalog.globalHuds.length).toBeGreaterThan(0);

      // Find Assault Rifle or Pistol
      const ar = catalog.weapons.find((w) => w.path.includes('assault rifle')) ?? catalog.weapons[0];
      expect(ar.hudChain.length).toBeGreaterThan(0);
      expect(ar.hudChain[0].elements.length).toBeGreaterThan(0);
      expect(ar.stats.length).toBeGreaterThan(5);
    },
  );

  it.skipIf(!fs.existsSync(BG_PATH))(
    'applies live HUD anchor, offset, scale, and hidden edits and live weapon stat edits in bloodgulch.map',
    () => {
      const buf = Buffer.from(fs.readFileSync(BG_PATH));
      const header = parseCacheFileHeader(buf);
      const tagIndex = parseTagIndex(buf, header);

      const catalog = inspectMapHudAndUiTargets(buf, header, tagIndex);
      const weap = catalog.weapons[0];
      const level0 = weap.hudChain[0];
      const elem0 = level0.elements[0];

      // 1. Test anchor edit
      const resAnchor = applyLiveHudEdit(buf, header, tagIndex, {
        hudTagIndex: level0.hudTagIndex,
        editType: 'anchor',
        anchorIndex: 4, // CENTRE
      });
      const updatedCat1 = inspectMapHudAndUiTargets(
        resAnchor.buffer,
        resAnchor.header,
        resAnchor.tagIndex,
      );
      expect(updatedCat1.weapons[0].hudChain[0].anchorIndex).toBe(4);
      expect(updatedCat1.weapons[0].hudChain[0].anchorName).toBe('CENTRE');

      // 2. Test element offset & scale edit
      const resElem = applyLiveHudEdit(
        resAnchor.buffer,
        resAnchor.header,
        resAnchor.tagIndex,
        {
          hudTagIndex: level0.hudTagIndex,
          editType: 'element',
          offsetFieldPath: elem0.offsetFieldPath,
          scaleXFieldPath: elem0.scaleXFieldPath,
          scaleYFieldPath: elem0.scaleYFieldPath,
          x: 42,
          y: -18,
          scaleX: 1.5,
          scaleY: 2.0,
        },
      );
      const updatedCat2 = inspectMapHudAndUiTargets(
        resElem.buffer,
        resElem.header,
        resElem.tagIndex,
      );
      const updatedElem = updatedCat2.weapons[0].hudChain[0].elements[0];
      expect(updatedElem.x).toBe(42);
      expect(updatedElem.y).toBe(-18);
      expect(updatedElem.scaleX).toBeCloseTo(1.5, 3);
      expect(updatedElem.scaleY).toBeCloseTo(2.0, 3);

      // 3. Test live weapon stat edit
      const stat0 = weap.stats[0];
      const nextVal = stat0.value + stat0.step;
      const statRes = applyLiveWeaponStatEdit(
        resElem.buffer,
        resElem.header,
        resElem.tagIndex,
        {
          targetTagIndex: stat0.targetTagIndex,
          fieldPath: stat0.fieldPath,
          boundsIndex: stat0.boundsIndex,
          value: nextVal,
          conversion: stat0.conversion,
        },
      );
      expect(statRes.ok).toBe(true);
    },
  );

  it.skipIf(!fs.existsSync(BG_PATH))(
    'injects a custom PNG into a HUD bitmap slot locally inside the open map without modifying bitmaps.map',
    () => {
      const buf = Buffer.from(fs.readFileSync(BG_PATH));
      const header = parseCacheFileHeader(buf);
      const tagIndex = parseTagIndex(buf, header);

      const catalog = inspectMapHudAndUiTargets(buf, header, tagIndex);
      const weap = catalog.weapons[0];
      const elemWithBitm = weap.hudChain[0].elements.find(
        (e) => e.bitmapTagIndex !== null && e.bitmapFieldPath,
      );
      expect(elemWithBitm).toBeDefined();
      if (!elemWithBitm || elemWithBitm.bitmapTagIndex === null || !elemWithBitm.bitmapFieldPath) return;

      // Create a 16x16 cyan PNG in memory
      const rgba = Buffer.alloc(16 * 16 * 4);
      for (let i = 0; i < 16 * 16; i++) {
        rgba[i * 4 + 0] = 40;
        rgba[i * 4 + 1] = 150;
        rgba[i * 4 + 2] = 255;
        rgba[i * 4 + 3] = 255;
      }
      const pngBuf = encodeRgbaToPng(rgba, 16, 16);

      const injected = injectHudElementBitmap(buf, header, tagIndex, {
        hudTagIndex: weap.hudChain[0].hudTagIndex,
        bitmapFieldPath: elemWithBitm.bitmapFieldPath,
        bitmapTagIndex: elemWithBitm.bitmapTagIndex,
        pngDataUrlOrBuffer: pngBuf,
        cloneDedicatedBitmapTag: true,
      });

      expect(injected.width).toBe(16);
      expect(injected.height).toBe(16);
      expect(injected.bitmapTagIndex).toBeGreaterThanOrEqual(tagIndex.entries.length);
      expect(injected.tagIndex.entries[injected.bitmapTagIndex].isExternal).toBe(false);
    },
  );

  it.skipIf(!fs.existsSync(UI_PATH))(
    'inspects and updates DeLa 640x480 UI widgets and ustr string tables in ui.map',
    () => {
      const buf = Buffer.from(fs.readFileSync(UI_PATH));
      const header = parseCacheFileHeader(buf);
      const tagIndex = parseTagIndex(buf, header);

      const catalog = inspectMapHudAndUiTargets(buf, header, tagIndex);
      expect(catalog.uiWidgets.length).toBeGreaterThan(10);
      expect(catalog.unicodeStringLists.length).toBeGreaterThan(5);

      const widgetWithChildren =
        catalog.uiWidgets.find((w) => w.childCount > 0) ?? catalog.uiWidgets[0];
      const canvasNode = inspectUiWidgetCanvas(
        buf,
        header,
        tagIndex,
        widgetWithChildren.tagIndex,
      );
      expect(canvasNode).not.toBeNull();
      if (!canvasNode) return;

      const origBounds = [...canvasNode.localBounds] as [number, number, number, number];
      updateUiWidgetPlacement(buf, header, tagIndex, {
        widgetTagIndex: canvasNode.tagIndex,
        bounds: [origBounds[0] + 10, origBounds[1] + 20, origBounds[2] + 10, origBounds[3] + 20],
      });

      const updatedNode = inspectUiWidgetCanvas(
        buf,
        header,
        tagIndex,
        widgetWithChildren.tagIndex,
      );
      expect(updatedNode?.localBounds[0]).toBe(origBounds[0] + 10);
      expect(updatedNode?.localBounds[1]).toBe(origBounds[1] + 20);

      // Test saving a unicode_string_list table
      const ustrTag = catalog.unicodeStringLists.find((u) => !u.isExternal) ?? catalog.unicodeStringLists[0];
      const savedUstr = saveUnicodeStringListTable(buf, header, tagIndex, ustrTag.tagIndex, [
        'CUSTOM HALO CE MENU ITEM 1',
        'CUSTOM HALO CE MENU ITEM 2',
      ]);
      expect(savedUstr.entryCount).toBe(2);
    },
  );
});
