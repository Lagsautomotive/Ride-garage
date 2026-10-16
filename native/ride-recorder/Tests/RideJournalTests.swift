import Foundation
import XCTest
@testable import RideJournal

final class RideJournalTests: XCTestCase {
    private func directory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("ride-journal-tests-" + UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }
    private func point(_ timestamp: Double, latitude: Double = 51, longitude: Double = -0.1,
                       accuracy: Double = 5, speed: Double? = 10) -> RidePoint {
        RidePoint(latitude: latitude, longitude: longitude, timestamp: timestamp,
                  accuracy: accuracy, speed: speed, segment: 999)
    }
    func testKeepsEveryTurnAndOriginalAccuracy() throws {
        let journal = try RideJournal(directory: directory())
        try journal.start(name: "Street corners", country: "GB", at: 1_000, id: "corners")
        XCTAssertTrue(try journal.append(point(2_000), receivedAt: 2_100))
        XCTAssertTrue(try journal.append(point(2_500, latitude: 51.001), receivedAt: 2_600))
        XCTAssertTrue(try journal.append(point(3_000, latitude: 51.001, longitude: -0.099, accuracy: 200), receivedAt: 3_100))
        XCTAssertEqual(journal.session?.points.count, 3)
        XCTAssertEqual(journal.session?.points.map(\.timestamp), [2_000, 2_500, 3_000])
        XCTAssertEqual(journal.session?.points.last?.accuracy, 200)
        XCTAssertEqual(journal.session?.points.map(\.segment), [0, 0, 0])
    }
    func testPauseResumeAndGapsBreakSegmentsAndExcludePausedTime() throws {
        let journal = try RideJournal(directory: directory())
        try journal.start(name: "Ride", country: "", at: 1_000)
        try journal.append(point(2_000), receivedAt: 2_000)
        try journal.pause(at: 5_000)
        XCTAssertFalse(try journal.append(point(6_000), receivedAt: 6_000))
        try journal.resume(at: 10_000)
        XCTAssertFalse(try journal.append(point(9_000), receivedAt: 11_000))
        try journal.append(point(11_000), receivedAt: 11_000)
        try journal.append(point(42_000), receivedAt: 42_000)
        try journal.stop(at: 43_000)
        XCTAssertEqual(journal.session?.points.map(\.segment), [0, 1, 2])
        XCTAssertEqual(journal.session?.durationMs, 37_000)
        XCTAssertEqual(journal.session?.endedAt, 43_000)
    }
    func testRestartPreservesFixesAndInterruptsWithoutCountingOfflineTime() throws {
        let url = try directory()
        let original = try RideJournal(directory: url)
        try original.start(name: "Commute", country: "GB", at: 1_000, id: "recovery")
        try original.append(point(2_000), receivedAt: 2_100)
        let recovered = try RideJournal(directory: url)
        XCTAssertEqual(recovered.session?.id, "recovery")
        XCTAssertEqual(recovered.session?.status, .interrupted)
        XCTAssertEqual(recovered.session?.durationMs, 1_100)
        XCTAssertEqual(recovered.snapshot(at: 9_000_000)?.durationMs, 1_100)
        XCTAssertEqual(recovered.session?.points.count, 1)
        XCTAssertNotNil(recovered.session?.lastError)
        XCTAssertFalse(try recovered.append(point(3_000), receivedAt: 3_000))
        try recovered.resume(at: 10_000)
        try recovered.append(point(11_000), receivedAt: 11_000)
        XCTAssertEqual(recovered.session?.points.map(\.segment), [0, 1])
        XCTAssertNil(recovered.session?.lastError)
        let secondRecovery = try RideJournal(directory: url)
        XCTAssertEqual(secondRecovery.session?.status, .interrupted)
        XCTAssertEqual(secondRecovery.session?.points.count, 2)
        XCTAssertEqual(secondRecovery.session?.durationMs, 2_100)
    }
    func testPausedAndStoppedSessionsStayAvailableAfterRestart() throws {
        let url = try directory()
        let original = try RideJournal(directory: url)
        try original.start(name: "Ride", country: "", at: 1_000, id: "saved")
        try original.pause(at: 2_000)
        let paused = try RideJournal(directory: url)
        XCTAssertEqual(paused.session?.status, .paused)
        XCTAssertEqual(paused.snapshot(at: 50_000)?.durationMs, 1_000)
        try paused.stop(at: 60_000)
        let stopped = try RideJournal(directory: url)
        XCTAssertEqual(stopped.session?.status, .stopped)
        XCTAssertEqual(stopped.session?.durationMs, 1_000)
        XCTAssertEqual(stopped.session?.endedAt, 60_000)
    }
    func testSnapshotAddsOnlyCurrentActiveTime() throws {
        let journal = try RideJournal(directory: directory())
        try journal.start(name: "Ride", country: "", at: 1_000)
        XCTAssertEqual(journal.snapshot(at: 4_000)?.durationMs, 3_000)
        XCTAssertEqual(journal.session?.durationMs, 0)
        try journal.pause(at: 4_000)
        XCTAssertEqual(journal.snapshot(at: 10_000)?.durationMs, 3_000)
        try journal.resume(at: 20_000)
        XCTAssertEqual(journal.snapshot(at: 21_000)?.durationMs, 4_000)
    }
    func testTornFinalRecordRepairsOnlyTailAndKeepsPriorFixes() throws {
        let url = try directory()
        let original = try RideJournal(directory: url)
        try original.start(name: "Ride", country: "", at: 1_000)
        try original.append(point(2_000), receivedAt: 2_000)
        let handle = try FileHandle(forWritingTo: url.appendingPathComponent("ride.jsonl"))
        _ = try handle.seekToEnd()
        try handle.write(contentsOf: Data("{\"kind\":\"point\"".utf8))
        try handle.synchronize()
        try handle.close()
        let recovered = try RideJournal(directory: url)
        XCTAssertEqual(recovered.session?.points.count, 1)
        XCTAssertEqual(recovered.session?.status, .interrupted)
        let names = try FileManager.default.contentsOfDirectory(atPath: url.path)
        XCTAssertEqual(names.filter { $0.hasPrefix("incomplete-tail-") }.count, 1)
        try recovered.resume(at: 5_000)
        try recovered.append(point(6_000), receivedAt: 6_000)
        XCTAssertEqual(try RideJournal(directory: url).session?.points.count, 2)
    }
    func testCompleteCorruptRecordIsPreservedAndDoesNotSilentlyLoseHistory() throws {
        let url = try directory()
        let journal = try RideJournal(directory: url)
        try journal.start(name: "Ride", country: "", at: 1_000)
        let file = url.appendingPathComponent("ride.jsonl")
        let handle = try FileHandle(forWritingTo: file)
        _ = try handle.seekToEnd()
        try handle.write(contentsOf: Data("not-json\n".utf8))
        try handle.close()
        let before = try Data(contentsOf: file)
        XCTAssertThrowsError(try RideJournal(directory: url))
        XCTAssertEqual(try Data(contentsOf: file), before)
    }
    func testInvalidStaleDuplicateAndOutOfOrderFixesAreIgnored() throws {
        let journal = try RideJournal(directory: directory())
        try journal.start(name: "Ride", country: "", at: 1_000)
        XCTAssertFalse(try journal.append(point(999), receivedAt: 2_000))
        XCTAssertFalse(try journal.append(point(2_000, accuracy: -1), receivedAt: 2_000))
        XCTAssertFalse(try journal.append(point(2_000, latitude: .nan), receivedAt: 2_000))
        XCTAssertFalse(try journal.append(point(2_000, latitude: 91), receivedAt: 2_000))
        XCTAssertFalse(try journal.append(point(2_000, longitude: 181), receivedAt: 2_000))
        XCTAssertFalse(try journal.append(point(2_000, speed: -1), receivedAt: 2_000))
        XCTAssertFalse(try journal.append(point(50_000), receivedAt: 2_000))
        XCTAssertTrue(try journal.append(point(2_000, accuracy: 0, speed: nil), receivedAt: 2_000))
        XCTAssertFalse(try journal.append(point(2_000), receivedAt: 2_100))
        XCTAssertFalse(try journal.append(point(1_500), receivedAt: 2_100))
        XCTAssertEqual(journal.session?.points.count, 1)
        XCTAssertNil(journal.session?.points.first?.speed)
    }
    func testOnlyMatchingStoppedRideCanBeAcknowledged() throws {
        let url = try directory()
        let journal = try RideJournal(directory: url)
        try journal.start(name: "Ride", country: "", at: 1_000, id: "only-this-one")
        XCTAssertThrowsError(try journal.acknowledge(id: "only-this-one"))
        XCTAssertThrowsError(try journal.start(name: "Other", country: "", at: 2_000))
        try journal.stop(at: 3_000)
        try journal.stop(at: 4_000)
        XCTAssertEqual(journal.session?.endedAt, 3_000)
        XCTAssertThrowsError(try journal.acknowledge(id: "wrong"))
        XCTAssertNotNil(try RideJournal(directory: url).session)
        try journal.acknowledge(id: "only-this-one")
        XCTAssertNil(journal.session)
        XCTAssertNil(try RideJournal(directory: url).session)
        try journal.start(name: "Next", country: "", at: 5_000)
        XCTAssertEqual(journal.session?.name, "Next")
    }
    func testMetadataIsDurableAndDoesNotAlterRecordedCoordinates() throws {
        let url = try directory()
        let journal = try RideJournal(directory: url)
        try journal.start(name: "  Original  ", country: "  GB  ", at: 1_000)
        try journal.append(point(2_000), receivedAt: 2_000)
        try journal.updateMetadata(name: " Updated ", country: " FR ", at: 2_500)
        try journal.pause(at: 3_000)
        let reopened = try RideJournal(directory: url)
        XCTAssertEqual(reopened.session?.name, "Updated")
        XCTAssertEqual(reopened.session?.country, "FR")
        XCTAssertEqual(reopened.session?.points.count, 1)
        XCTAssertEqual(reopened.session?.points.first?.latitude, 51)
    }
    func testStorageFailurePreventsFurtherAppendAndKeepsAnInterruptedSnapshot() throws {
        let url = try directory()
        let journal = try RideJournal(directory: url)
        try journal.start(name: "Ride", country: "", at: 1_000)
        try journal.append(point(2_000), receivedAt: 2_000)
        try FileManager.default.removeItem(at: url.appendingPathComponent("ride.jsonl"))
        XCTAssertThrowsError(try journal.append(point(3_000), receivedAt: 3_000))
        journal.failClosed(at: 3_000, reason: "Storage failure")
        XCTAssertEqual(journal.session?.status, .interrupted)
        XCTAssertEqual(journal.session?.points.count, 1)
        XCTAssertEqual(journal.session?.lastError, "Storage failure")
        XCTAssertThrowsError(try journal.resume(at: 4_000))
    }
    #if os(iOS)
    func testDirectoryAndJournalAreAvailableAfterFirstUnlock() throws {
        let url = try directory()
        let journal = try RideJournal(directory: url)
        try journal.start(name: "Lock screen", country: "", at: 1_000)
        let expected = FileProtectionType.completeUntilFirstUserAuthentication
        for path in [url.path, url.appendingPathComponent("ride.jsonl").path] {
            let attributes = try FileManager.default.attributesOfItem(atPath: path)
            XCTAssertEqual(attributes[.protectionKey] as? FileProtectionType, expected)
        }
    }
    #endif
    func testSnapshotRemainsStableAfterAnotherFix() throws {
        let journal = try RideJournal(directory: directory())
        try journal.start(name: "Ride", country: "", at: 1_000)
        try journal.append(point(2_000), receivedAt: 2_000)
        let snapshot = journal.snapshot(at: 2_000)
        try journal.append(point(3_000), receivedAt: 3_000)
        XCTAssertEqual(snapshot?.points.count, 1)
        XCTAssertEqual(journal.session?.points.count, 2)
    }
    func testLongRideReplayRetainsAllFixesAndCanContinue() throws {
        let url = try directory()
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        let count = 20_000
        var lines = ["{\"version\":1,\"kind\":\"start\",\"at\":1000,\"id\":\"long-ride\",\"name\":\"Long ride\",\"country\":\"GB\"}"]
        for index in 0..<count {
            let timestamp = 2_000 + index * 1_000
            let latitude = 51.0 + Double(index) / 10_000_000
            lines.append("{\"version\":1,\"kind\":\"point\",\"at\":\(timestamp),\"point\":{\"latitude\":\(latitude),\"longitude\":-0.1,\"timestamp\":\(timestamp),\"accuracy\":5,\"speed\":10,\"segment\":0}}")
        }
        let pausedAt = 2_000 + count * 1_000
        lines.append("{\"version\":1,\"kind\":\"pause\",\"at\":\(pausedAt)}")
        try Data((lines.joined(separator: "\n") + "\n").utf8).write(to: url.appendingPathComponent("ride.jsonl"), options: .atomic)
        let recovered = try RideJournal(directory: url)
        XCTAssertEqual(recovered.session?.points.count, count)
        XCTAssertEqual(recovered.session?.status, .paused)
        XCTAssertEqual(recovered.session?.points.first?.timestamp, 2_000)
        XCTAssertEqual(recovered.session?.points.last?.timestamp, Double(pausedAt - 1_000))
        try recovered.resume(at: Double(pausedAt + 1_000))
        XCTAssertTrue(try recovered.append(point(Double(pausedAt + 2_000)), receivedAt: Double(pausedAt + 2_000)))
        XCTAssertEqual(recovered.session?.points.count, count + 1)
        XCTAssertEqual(recovered.session?.points.last?.segment, 1)
    }

}
