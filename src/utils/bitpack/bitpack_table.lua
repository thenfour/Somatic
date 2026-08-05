-- LSB-first bit reader for a 1-based Lua byte table.
-- src = { data = byteTable, offset = zeroBasedByteOffset }
local function _bp_make_table_reader(src)
	local data = src.data
	local bytePos = src.offset or 0
	local bitPos = 0

	local function _bp_align_byte()
		if bitPos ~= 0 then
			bitPos = 0
			bytePos = bytePos + 1
		end
	end

	local function _bp_read_bits(n)
		local remaining = n
		local out = 0
		local outShift = 0
		while remaining > 0 do
			local avail = 8 - bitPos
			local take = math.min(remaining, avail)
			local mask = (1 << take) - 1
			local part = ((data[bytePos + 1] or 0) >> bitPos) & mask
			out = out | (part << outShift)
			bitPos = bitPos + take
			if bitPos == 8 then
				bitPos = 0
				bytePos = bytePos + 1
			end
			outShift = outShift + take
			remaining = remaining - take
		end
		return out
	end

	local function _bp_read_sbits(n)
		local v = _bp_read_bits(n)
		local sign = 1 << (n - 1)
		if (v & sign) ~= 0 then
			v = v - (1 << n)
		end
		return v
	end

	return {
		align = _bp_align_byte,
		u = _bp_read_bits,
		i = _bp_read_sbits,
	}
end
