import test from "node:test";
import assert from "node:assert/strict";
import postDetails from "../post-details.js";

test("shows each stored flight day with show-up and flight times", () => {
  const result = postDetails.rows({ daySchedules:[{
    month:"2026-08", day:13, type:"국내선", title:"7C1403", dep:"ICN", arr:"FUK",
    reportTime:"10:30", departureTime:"11:40", arrivalTime:"13:10", releaseTime:"13:45",
  }] });
  assert.deepEqual(result, [{
    fallback:false, date:"8/13", type:"국내선", title:"7C1403", route:"ICN→FUK",
    reportTime:"10:30", departureTime:"11:40", arrivalTime:"13:10", releaseTime:"13:45",
  }]);
});

test("legacy posts show only stored first and last times", () => {
  const [result] = postDetails.rows({
    patternName:"8/13~8/15 국제선", type:"국제선", summary:"ICN-FUK · FUK-ICN",
    reportTime:"10:30", releaseTime:"18:20",
  });
  assert.equal(result.fallback, true);
  assert.equal(result.reportTime, "10:30");
  assert.equal(result.releaseTime, "18:20");
  assert.equal(result.departureTime, null);
  assert.equal(result.arrivalTime, null);
});
