import SwiftUI
import WidgetKit

// "Next shift" on the home screen and lock screen. The app writes the
// signed-in person's upcoming shifts into the shared App Group whenever it
// opens or comes back to the foreground (Frontend/src/lib/widget.ts →
// WidgetBridgePlugin.swift); this only reads them. The timeline has an entry
// at every shift start and end, so "On now" / the next shift roll over by
// themselves without the app running.

private let appGroup = "group.com.fruitcrew.app"
private let storageKey = "upcomingShifts"

// MARK: - data

struct WidgetShift: Codable, Hashable {
    let start: Date
    let end: Date
    let store: String
    let coworkers: [String]
}

private struct Stored: Codable {
    let signedIn: Bool
    let shifts: [WidgetShift]
}

private func loadStored() -> Stored? {
    guard let json = UserDefaults(suiteName: appGroup)?.string(forKey: storageKey),
          let data = json.data(using: .utf8) else { return nil }
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .custom { d in
        let s = try d.singleValueContainer().decode(String.self)
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = f.date(from: s) { return date }
        f.formatOptions = [.withInternetDateTime]
        if let date = f.date(from: s) { return date }
        throw DecodingError.dataCorruptedError(in: try d.singleValueContainer(), debugDescription: "bad date \(s)")
    }
    return try? decoder.decode(Stored.self, from: data)
}

struct ShiftEntry: TimelineEntry {
    let date: Date
    /** nil = not signed in on this phone */
    let upcoming: [WidgetShift]?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> ShiftEntry {
        ShiftEntry(date: Date(), upcoming: [Self.sample])
    }

    func getSnapshot(in context: Context, completion: @escaping (ShiftEntry) -> Void) {
        let stored = loadStored()
        let shifts = stored?.shifts.filter { $0.end > Date() } ?? []
        // the widget gallery shows a sample rather than an empty card
        completion(ShiftEntry(date: Date(), upcoming: context.isPreview && shifts.isEmpty ? [Self.sample] : (stored?.signedIn == false ? nil : shifts)))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ShiftEntry>) -> Void) {
        let now = Date()
        guard let stored = loadStored(), stored.signedIn else {
            completion(Timeline(entries: [ShiftEntry(date: now, upcoming: nil)], policy: .never))
            return
        }
        let shifts = stored.shifts.filter { $0.end > now }.sorted { $0.start < $1.start }
        // an entry now, then at each start (→ "On now") and end (→ the next one)
        var moments = Set<Date>([now])
        for s in shifts.prefix(8) {
            if s.start > now { moments.insert(s.start) }
            moments.insert(s.end)
        }
        let entries = moments.sorted().map { t in ShiftEntry(date: t, upcoming: shifts.filter { $0.end > t }) }
        completion(Timeline(entries: entries, policy: .atEnd))
    }

    static let sample = WidgetShift(
        start: Calendar.current.date(bySettingHour: 16, minute: 0, second: 0, of: Date().addingTimeInterval(86_400))!,
        end: Calendar.current.date(bySettingHour: 22, minute: 0, second: 0, of: Date().addingTimeInterval(86_400))!,
        store: "Downtown",
        coworkers: ["Maya", "Sofia"]
    )
}

// MARK: - formatting

private extension Color {
    static let ink = Color(red: 0x3A / 255, green: 0x2B / 255, blue: 0x4D / 255)
    static let cream = Color(red: 0xFF / 255, green: 0xF8 / 255, blue: 0xEC / 255)
    static let brandGreen = Color(red: 0x3F / 255, green: 0x99 / 255, blue: 0x50 / 255)
    static let mutedInk = Color(red: 0x7A / 255, green: 0x6E / 255, blue: 0x8C / 255)
}

private func timeText(_ d: Date) -> String {
    let f = DateFormatter()
    f.locale = .current
    f.setLocalizedDateFormatFromTemplate(Calendar.current.component(.minute, from: d) == 0 ? "j" : "jmm")
    return f.string(from: d)
}

private func rangeText(_ s: WidgetShift) -> String { "\(timeText(s.start))–\(timeText(s.end))" }

private func dayText(_ d: Date, now: Date) -> String {
    let cal = Calendar.current
    if cal.isDate(d, inSameDayAs: now) { return String(localized: "Today") }
    if let tomorrow = cal.date(byAdding: .day, value: 1, to: now), cal.isDate(d, inSameDayAs: tomorrow) { return String(localized: "Tomorrow") }
    let f = DateFormatter()
    f.locale = .current
    f.setLocalizedDateFormatFromTemplate("EEEMMMd")
    return f.string(from: d)
}

private func shortDay(_ d: Date, now: Date) -> String {
    let cal = Calendar.current
    if cal.isDate(d, inSameDayAs: now) { return String(localized: "Today") }
    let f = DateFormatter()
    f.locale = .current
    f.setLocalizedDateFormatFromTemplate("EEE")
    return f.string(from: d)
}

// MARK: - views

private struct Caption: View {
    let text: String
    var color: Color = .mutedInk
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 10, weight: .heavy, design: .rounded))
            .foregroundColor(color)
            .lineLimit(1)
    }
}

private struct Empty: View {
    let signedOut: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Caption(text: "Fruit Crew")
            Spacer(minLength: 0)
            Text(signedOut ? "Sign in to see your shifts" : "No shifts coming up")
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundColor(.ink)
                .minimumScaleFactor(0.8)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

private struct NextShift: View {
    let shift: WidgetShift
    let now: Date
    var body: some View {
        let onNow = shift.start <= now
        VStack(alignment: .leading, spacing: 3) {
            Caption(text: onNow ? String(localized: "On now") : String(localized: "Next shift"), color: onNow ? .brandGreen : .mutedInk)
            Text(onNow ? String(localized: "until \(timeText(shift.end))") : dayText(shift.start, now: now))
                .font(.system(size: 17, weight: .heavy, design: .rounded))
                .foregroundColor(.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            if !onNow {
                Text(rangeText(shift))
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundColor(.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Spacer(minLength: 0)
            Text(shift.store)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundColor(.mutedInk)
                .lineLimit(1)
            if !shift.coworkers.isEmpty {
                Text(String(localized: "with \(shift.coworkers.prefix(2).joined(separator: ", "))"))
                    .font(.system(size: 11, weight: .regular, design: .rounded))
                    .foregroundColor(.mutedInk)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct LaterRow: View {
    let shift: WidgetShift
    let now: Date
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(shortDay(shift.start, now: now))
                .font(.system(size: 11, weight: .heavy, design: .rounded))
                .foregroundColor(.ink)
            Text(rangeText(shift))
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundColor(.mutedInk)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }
}

struct FruitCrewWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: ShiftEntry

    var body: some View {
        content
            .widgetURL(URL(string: "fruitcrew://my-shifts"))
            .modifier(Background())
    }

    @ViewBuilder private var content: some View {
        let next = entry.upcoming?.first
        switch family {
        case .accessoryInline:
            if let s = next {
                Text(s.start <= entry.date ? "On now until \(timeText(s.end))" : "\(shortDay(s.start, now: entry.date)) \(timeText(s.start)) · \(s.store)")
            } else {
                Text(entry.upcoming == nil ? "Fruit Crew" : "No shifts coming up")
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                if let s = next {
                    Text(s.start <= entry.date ? String(localized: "On now") : String(localized: "Next shift")).font(.caption2).bold()
                    Text(s.start <= entry.date ? "until \(timeText(s.end))" : "\(shortDay(s.start, now: entry.date)) \(rangeText(s))").font(.headline).lineLimit(1).minimumScaleFactor(0.7)
                    Text(s.store).font(.caption).lineLimit(1)
                } else {
                    Text("Fruit Crew").font(.caption2).bold()
                    Text(entry.upcoming == nil ? "Sign in to see your shifts" : "No shifts coming up").font(.caption).lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .systemMedium:
            if let s = next {
                HStack(alignment: .top, spacing: 12) {
                    NextShift(shift: s, now: entry.date)
                    let later = Array((entry.upcoming ?? []).dropFirst().prefix(3))
                    if !later.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Caption(text: String(localized: "After that"))
                            ForEach(later, id: \.self) { LaterRow(shift: $0, now: entry.date) }
                            Spacer(minLength: 0)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    }
                }
            } else {
                Empty(signedOut: entry.upcoming == nil)
            }
        default:
            if let s = next { NextShift(shift: s, now: entry.date) } else { Empty(signedOut: entry.upcoming == nil) }
        }
    }
}

/// iOS 17 wants widgets to declare their background; older versions just get a padded view.
private struct Background: ViewModifier {
    @Environment(\.widgetFamily) var family
    func body(content: Content) -> some View {
        let isAccessory = family == .accessoryInline || family == .accessoryRectangular
        if #available(iOSApplicationExtension 17.0, *) {
            content.containerBackground(for: .widget) { isAccessory ? Color.clear : Color.cream }
        } else {
            content.padding().background(isAccessory ? Color.clear : Color.cream)
        }
    }
}

struct FruitCrewWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FruitCrewNextShift", provider: Provider()) { entry in
            FruitCrewWidgetView(entry: entry)
        }
        .configurationDisplayName("Next shift")
        .description("Your next Fruit Crew shift at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct FruitCrewWidgets: WidgetBundle {
    var body: some Widget {
        FruitCrewWidget()
    }
}
