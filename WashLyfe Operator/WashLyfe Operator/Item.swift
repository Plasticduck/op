//
//  Item.swift
//  WashLyfe Operator
//
//  Created by Benjamin Jowers on 5/27/26.
//

import Foundation
import SwiftData

@Model
final class Item {
    var timestamp: Date
    
    init(timestamp: Date) {
        self.timestamp = timestamp
    }
}
