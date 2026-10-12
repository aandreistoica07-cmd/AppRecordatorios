import Foundation
import Capacitor
import SwiftUI
import CryptoKit
#if canImport(AlarmKit)
import AlarmKit
#endif

#if canImport(AlarmKit)
@available(iOS 26.0, *)
nonisolated public struct EmptyAlarmMetadata: AlarmMetadata {
    public init() {}
}
#endif

@objc(AlarmKitPlugin)
public class AlarmKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AlarmKitPlugin"
    public let jsName = "AlarmKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleAlarm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelAlarm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listAlarms", returnType: CAPPluginReturnPromise)
    ]

    private let idToUuidStorageKey = "rutinas_alarmkit_id_to_uuid_v1"
    private let uuidToIdStorageKey = "rutinas_alarmkit_uuid_to_id_v1"

    // MARK: - Deterministic ID <-> UUID Mapping

    private func resolveAndPersistUUID(for appId: String) -> UUID {
        let trimmed = appId.trimmingCharacters(in: .whitespacesAndNewlines)
        if let directUUID = UUID(uuidString: trimmed) {
            saveMapping(appId: trimmed, uuidString: directUUID.uuidString.lowercased())
            return directUUID
        }

        let existingMap = loadIdToUuidMap()
        if let cachedUuidStr = existingMap[trimmed],
           let cachedUUID = UUID(uuidString: cachedUuidStr) {
            return cachedUUID
        }

        let digest = SHA256.hash(data: Data(trimmed.utf8))
        var bytes = Array(digest.prefix(16))
        // RFC 4122 variant & version 5 bits
        bytes[6] = (bytes[6] & 0x0F) | 0x50
        bytes[8] = (bytes[8] & 0x3F) | 0x80

        let uuidTuple: uuid_t = (
            bytes[0], bytes[1], bytes[2], bytes[3],
            bytes[4], bytes[5], bytes[6], bytes[7],
            bytes[8], bytes[9], bytes[10], bytes[11],
            bytes[12], bytes[13], bytes[14], bytes[15]
        )
        let generated = UUID(uuid: uuidTuple)
        saveMapping(appId: trimmed, uuidString: generated.uuidString.lowercased())
        return generated
    }

    private func loadIdToUuidMap() -> [String: String] {
        return UserDefaults.standard.dictionary(forKey: idToUuidStorageKey) as? [String: String] ?? [:]
    }

    private func loadUuidToIdMap() -> [String: String] {
        return UserDefaults.standard.dictionary(forKey: uuidToIdStorageKey) as? [String: String] ?? [:]
    }

    private func saveMapping(appId: String, uuidString: String) {
        let normalizedUuid = uuidString.lowercased()
        var idToUuid = loadIdToUuidMap()
        var uuidToId = loadUuidToIdMap()
        idToUuid[appId] = normalizedUuid
        uuidToId[normalizedUuid] = appId
        UserDefaults.standard.set(idToUuid, forKey: idToUuidStorageKey)
        UserDefaults.standard.set(uuidToId, forKey: uuidToIdStorageKey)
    }

    private func removeMapping(forAppId appId: String, uuidString: String) {
        let normalizedUuid = uuidString.lowercased()
        var idToUuid = loadIdToUuidMap()
        var uuidToId = loadUuidToIdMap()
        idToUuid.removeValue(forKey: appId)
        uuidToId.removeValue(forKey: normalizedUuid)
        UserDefaults.standard.set(idToUuid, forKey: idToUuidStorageKey)
        UserDefaults.standard.set(uuidToId, forKey: uuidToIdStorageKey)
    }

    private func parseISO8601Date(_ isoString: String) -> Date? {
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractionalFormatter.date(from: isoString) {
            return date
        }
        let standardFormatter = ISO8601DateFormatter()
        standardFormatter.formatOptions = [.withInternetDateTime]
        return standardFormatter.date(from: isoString)
    }

    #if canImport(AlarmKit)
    @available(iOS 26.0, *)
    private func mapAuthorizationState(_ state: AlarmManager.AuthorizationState) -> String {
        switch state {
        case .notDetermined:
            return "notDetermined"
        case .authorized:
            return "authorized"
        case .denied:
            return "denied"
        @unknown default:
            return "unknown"
        }
    }
    #endif

    // MARK: - Capacitor Plugin Methods

    @objc public func getStatus(_ call: CAPPluginCall) {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            let state = AlarmManager.shared.authorizationState
            let stateStr = mapAuthorizationState(state)
            call.resolve([
                "available": true,
                "authorized": state == .authorized,
                "authorizationState": stateStr
            ])
            return
        }
        #endif
        call.resolve([
            "available": false,
            "authorized": false,
            "authorizationState": "unavailable"
        ])
    }

    @objc override public func checkPermissions(_ call: CAPPluginCall) {
        getStatus(call)
    }

    @objc public func requestAuthorization(_ call: CAPPluginCall) {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            Task {
                do {
                    let currentState = AlarmManager.shared.authorizationState
                    if currentState == .authorized {
                        call.resolve([
                            "available": true,
                            "authorized": true,
                            "authorizationState": "authorized"
                        ])
                        return
                    }
                    let newState = try await AlarmManager.shared.requestAuthorization()
                    let stateStr = self.mapAuthorizationState(newState)
                    call.resolve([
                        "available": true,
                        "authorized": newState == .authorized,
                        "authorizationState": stateStr
                    ])
                } catch {
                    call.reject(
                        "Error al solicitar autorización de AlarmKit: \(error.localizedDescription) (\(String(describing: error)))",
                        "AUTH_ERROR",
                        error
                    )
                }
            }
            return
        }
        #endif
        call.resolve([
            "available": false,
            "authorized": false,
            "authorizationState": "unavailable"
        ])
    }

    @objc public func scheduleAlarm(_ call: CAPPluginCall) {
        guard let rawId = call.getString("id"), !rawId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.reject("El parámetro 'id' es obligatorio.", "INVALID_ARGS")
            return
        }
        guard let fechaISO = call.getString("fechaISO"), let targetDate = parseISO8601Date(fechaISO) else {
            call.reject("El parámetro 'fechaISO' no es una fecha ISO-8601 válida.", "INVALID_DATE")
            return
        }
        let etiqueta = call.getString("etiqueta")?.trimmingCharacters(in: .whitespacesAndNewlines)
        let titleText = (etiqueta?.isEmpty == false) ? etiqueta! : "Alarma · Rutinas"

        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            let alarmUUID = resolveAndPersistUUID(for: rawId)
            Task {
                do {
                    let currentAuth = AlarmManager.shared.authorizationState
                    if currentAuth == .notDetermined {
                        let requested = try await AlarmManager.shared.requestAuthorization()
                        if requested != .authorized {
                            call.reject(
                                "Permiso de AlarmKit denegado por el usuario (\(self.mapAuthorizationState(requested))).",
                                "PERMISSION_DENIED"
                            )
                            return
                        }
                    } else if currentAuth != .authorized {
                        call.reject(
                            "Permiso de AlarmKit no concedido (estado actual: \(self.mapAuthorizationState(currentAuth))). Actívalo en Ajustes de iOS.",
                            "PERMISSION_DENIED"
                        )
                        return
                    }

                    // Si existía una alarma previa con el mismo UUID, cancelarla de forma silenciosa antes de reprogramar
                    try? AlarmManager.shared.cancel(id: alarmUUID)

                    let stopButton = AlarmButton(
                        text: LocalizedStringResource(stringLiteral: "Detener"),
                        textColor: .white,
                        systemImageName: "stop.circle.fill"
                    )
                    let alertPresentation = AlarmPresentation.Alert(
                        title: LocalizedStringResource(stringLiteral: titleText),
                        stopButton: stopButton
                    )
                    let presentation = AlarmPresentation(alert: alertPresentation)
                    let attributes = AlarmAttributes<EmptyAlarmMetadata>(
                        presentation: presentation,
                        metadata: EmptyAlarmMetadata(),
                        tintColor: .teal
                    )

                    let configuration = AlarmManager.AlarmConfiguration<EmptyAlarmMetadata>.alarm(
                        schedule: .fixed(targetDate),
                        attributes: attributes,
                        stopIntent: nil,
                        secondaryIntent: nil,
                        sound: .default
                    )

                    let scheduledAlarm = try await AlarmManager.shared.schedule(
                        id: alarmUUID,
                        configuration: configuration
                    )

                    call.resolve([
                        "scheduled": true,
                        "id": rawId,
                        "uuid": scheduledAlarm.id.uuidString.lowercased(),
                        "scheduledAtISO": ISO8601DateFormatter().string(from: targetDate),
                        "authorizationState": self.mapAuthorizationState(AlarmManager.shared.authorizationState)
                    ])
                } catch AlarmManager.AlarmError.maximumLimitReached {
                    call.reject(
                        "AlarmManager.AlarmError.maximumLimitReached: Se alcanzó el límite máximo de alarmas programadas en iOS.",
                        "MAXIMUM_LIMIT_REACHED"
                    )
                } catch {
                    call.reject(
                        "Fallo al programar en AlarmKit: \(error.localizedDescription) (\(String(describing: error)))",
                        "SCHEDULE_FAILED",
                        error
                    )
                }
            }
            return
        }
        #endif

        call.reject("AlarmKit no está disponible en esta versión de iOS (requiere iOS 26.0+).", "UNAVAILABLE")
    }

    @objc public func cancelAlarm(_ call: CAPPluginCall) {
        guard let rawId = call.getString("id"), !rawId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.reject("El parámetro 'id' es obligatorio.", "INVALID_ARGS")
            return
        }

        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            let alarmUUID = resolveAndPersistUUID(for: rawId)
            do {
                try AlarmManager.shared.cancel(id: alarmUUID)
                removeMapping(forAppId: rawId, uuidString: alarmUUID.uuidString)
                call.resolve([
                    "cancelled": true,
                    "id": rawId,
                    "uuid": alarmUUID.uuidString.lowercased()
                ])
            } catch {
                removeMapping(forAppId: rawId, uuidString: alarmUUID.uuidString)
                call.resolve([
                    "cancelled": false,
                    "id": rawId,
                    "uuid": alarmUUID.uuidString.lowercased(),
                    "error": "\(error.localizedDescription) (\(String(describing: error)))"
                ])
            }
            return
        }
        #endif

        call.resolve([
            "cancelled": false,
            "id": rawId,
            "error": "AlarmKit no disponible"
        ])
    }

    @objc public func listAlarms(_ call: CAPPluginCall) {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            do {
                let activeAlarms = try AlarmManager.shared.alarms
                let uuidToId = loadUuidToIdMap()
                let serialized: [[String: Any]] = activeAlarms.map { alarm in
                    let uuidStr = alarm.id.uuidString.lowercased()
                    let mappedId = uuidToId[uuidStr] ?? uuidStr
                    return [
                        "id": mappedId,
                        "uuid": uuidStr,
                        "state": String(describing: alarm.state)
                    ]
                }
                call.resolve([
                    "alarms": serialized,
                    "count": serialized.count
                ])
            } catch {
                call.reject(
                    "Error al listar alarmas de AlarmKit: \(error.localizedDescription) (\(String(describing: error)))",
                    "LIST_FAILED",
                    error
                )
            }
            return
        }
        #endif

        call.resolve([
            "alarms": [],
            "count": 0
        ])
    }
}
