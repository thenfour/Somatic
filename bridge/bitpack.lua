-- bitpack.lua (generated)
-- LSB-first bits within each byte; assembled LSB-first into integers.
local function _bp_make_reader(__BP_BASE__)
	local bytePos = 0
	local bitPos = 0

	local function _bp_align_byte()
		if bitPos ~= 0 then
			bitPos = 0
			bytePos = bytePos + 1
		end
	end

	local function _bp_read_bits(n)
		local v = 0
		local shift = 0
		while n > 0 do
			local b = peek(__BP_BASE__ + bytePos)
			local avail = 8 - bitPos
			local k = (n < avail) and n or avail
			local mask = (1 << k) - 1
			local part = (b >> bitPos) & mask
			v = v | (part << shift)
			bitPos = bitPos + k
			if bitPos >= 8 then
				bitPos = 0
				bytePos = bytePos + 1
			end
			shift = shift + k
			n = n - k
		end
		return v
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
