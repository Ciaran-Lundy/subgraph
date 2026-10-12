import { Address, BigDecimal } from "@graphprotocol/graph-ts";
import { afterEach, assert, clearStore, describe, test } from "matchstick-as";
import {
  addRecentFeeVolume,
  createOrLoadTranscoder,
  updateRollingVolumes,
} from "../utils/helpers";

const recipient = Address.fromString("0x2000000000000000000000000000000000000002");

describe("rolling fee windows (BDR-17)", () => {
  afterEach(() => {
    clearStore();
  });

  test("days older than the window drop out of the 30/60/90 day sums", () => {
    let t = createOrLoadTranscoder(recipient.toHex(), 0);
    let day = 86400;
    addRecentFeeVolume(t, 100 * day, BigDecimal.fromString("1"));
    addRecentFeeVolume(t, 140 * day, BigDecimal.fromString("2"));
    addRecentFeeVolume(t, 175 * day, BigDecimal.fromString("4"));
    addRecentFeeVolume(t, 175 * day + 10, BigDecimal.fromString("8"));

    // On day 175: day 175 (12) is in all windows, day 140 (2) in 60/90,
    // day 100 (1) in 90 only
    assert.stringEquals("12", t.thirtyDayVolumeETH.toString());
    assert.stringEquals("14", t.sixtyDayVolumeETH.toString());
    assert.stringEquals("15", t.ninetyDayVolumeETH.toString());
    assert.i32Equals(3, t.recentFeeDays.length);

    // A round on day 200 with no new fees: day 140 leaves the 60 day window
    // and day 100 leaves the 90 day window (and the stored history)
    updateRollingVolumes(t, 200 * day);
    assert.stringEquals("12", t.thirtyDayVolumeETH.toString());
    assert.stringEquals("12", t.sixtyDayVolumeETH.toString());
    assert.stringEquals("14", t.ninetyDayVolumeETH.toString());
    assert.i32Equals(2, t.recentFeeDays.length);
  });
});
