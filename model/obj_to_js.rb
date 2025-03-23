#!/usr/bin/env ruby

input = ARGV[0]
output = ARGV[1]

def usage()
  puts
  puts "usage;   ./obj_to_js.rb <input_file> <output_js>"
  puts "Additionally, only provide simple OBJ files for one object and consisting solely of triangles"
  exit 1
end

if input.nil?
  puts "Please provide file to convert"
  usage
end

if output.nil?
  puts "Please provide output file to write"
  usage
end

faces = []
points = []

File.open(input).readlines.each do |line|
  tokens = line.chomp.split


  if tokens[0] == "v"
    points += [tokens[1..]]
  elsif tokens[0] == "f"
    faces += tokens[1..].map {|tok| tok.split("/")[0]}.to_a
  end
end

puts "Found #{faces.size/3} and #{points.size/3} points"

unswizled = faces.flat_map do |point_idx|
  points[point_idx.to_i - 1]
end

javascript_file_contents = "
// This was an auto generated file by obj_to_js.rb utility script
export const points = [#{unswizled.join ",\n"}]
"

File.write(output, javascript_file_contents)
puts("Successfully wrote #{unswizled.size} numbers to #{output}")
