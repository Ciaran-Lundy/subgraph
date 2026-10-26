import {
  afterEach,
  assert,
  beforeEach,
  clearStore,
  dataSourceMock,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { serviceURIUpdate } from "../src/mappings/serviceRegistry";
import {
  ARBITRUM_ONE,
  CURRENT_ROUND,
  eventId,
  L1_BLOCK,
  TIMESTAMP,
  TRANSCODER_A,
  TX_HASH,
} from "./helpers/constants";
import { atLogIndex, createServiceURIUpdateEvent } from "./helpers/events";
import { mockBlockNum } from "./helpers/mocks";
import { seedProtocol, seedTranscoder } from "./helpers/store";

const SERVICE_URI = "https://orchestrator.example:8935";
const NEW_SERVICE_URI = "https://orchestrator.example:9935";

beforeEach(() => {
  dataSourceMock.setNetwork(ARBITRUM_ONE);
  seedProtocol();
  mockBlockNum(L1_BLOCK);
});

afterEach(() => {
  clearStore();
});

describe("serviceURIUpdate", () => {
  test("an unknown address becomes an unregistered transcoder with the URI", () => {
    serviceURIUpdate(createServiceURIUpdateEvent(TRANSCODER_A, SERVICE_URI));

    let transcoder = TRANSCODER_A.toHex();
    assert.fieldEquals("Transcoder", transcoder, "serviceURI", SERVICE_URI);
    assert.fieldEquals("Transcoder", transcoder, "status", "NotRegistered");
    assert.fieldEquals("Transcoder", transcoder, "totalStake", "0");
    assert.fieldEquals("LivepeerAccount", transcoder, "lastUpdatedTimestamp", TIMESTAMP.toString());
    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("ServiceURIUpdateEvent", id, "addr", transcoder);
    assert.fieldEquals("ServiceURIUpdateEvent", id, "serviceURI", SERVICE_URI);
    assert.fieldEquals("ServiceURIUpdateEvent", id, "round", CURRENT_ROUND);
  });

  test("an existing transcoder keeps its stake and status", () => {
    seedTranscoder(TRANSCODER_A, "Registered", "500");

    serviceURIUpdate(createServiceURIUpdateEvent(TRANSCODER_A, SERVICE_URI));

    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "serviceURI", SERVICE_URI);
    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "status", "Registered");
    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "totalStake", "500");
  });

  // Matchstick stores an empty string as null (graph-node does not), so the
  // empty-URI case cannot be expressed here.
  test("a second update in the same transaction replaces the URI", () => {
    serviceURIUpdate(createServiceURIUpdateEvent(TRANSCODER_A, SERVICE_URI));
    serviceURIUpdate(atLogIndex(createServiceURIUpdateEvent(TRANSCODER_A, NEW_SERVICE_URI), 2));

    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "serviceURI", NEW_SERVICE_URI);
    assert.fieldEquals("ServiceURIUpdateEvent", eventId(TX_HASH, 1), "serviceURI", SERVICE_URI);
    assert.entityCount("ServiceURIUpdateEvent", 2);
  });
});
