#!/usr/bin/perl

use Modern::Perl;

use Test::More tests => 9;
use Test::NoWarnings;

use FindBin;
use lib "$FindBin::Bin/..";

BEGIN {
    use_ok('Koha::Plugin::Com::OlorinAutoPrinter::Olorin');
}

my $metadata = $Koha::Plugin::Com::OlorinAutoPrinter::Olorin::metadata;
is( $metadata->{namespace}, 'olorin', 'metadata namespace is olorin' );
ok( $metadata->{name} && $metadata->{version} && $metadata->{minimum_version}, 'metadata is complete' );

my $types = Koha::Plugin::Com::OlorinAutoPrinter::Olorin->slip_types;

my %seen;
my $duplicates = grep { $seen{ $_->{key} }++ } @$types;
is( $duplicates, 0, 'slip type keys are unique' );

my $bad_containers = grep { $_->{container} !~ /^#/ } @$types;
is( $bad_containers, 0, 'every container is an id selector' );

my %printers = map { $_ => 1 } @$Koha::Plugin::Com::OlorinAutoPrinter::Olorin::PRINTER_KEYS;
my $bad_printers = grep { !$printers{ $_->{default_printer} } } @$types;
is( $bad_printers, 0, 'every default printer is a known logical key' );

my ($custom_index) = grep { $types->[$_]->{key} eq 'patron_custom' } 0 .. $#$types;
my @named_printslip = grep {
    $types->[$_]->{path} eq '/members/printslip.pl' && $types->[$_]->{key} ne 'patron_custom'
} 0 .. $#$types;
ok( $custom_index > $_, "patron_custom is ordered after $types->[$_]{key}" ) for ();
is( scalar(@named_printslip), 3, 'three named printslip.pl slip types exist' );
ok( ( !grep { $_ > $custom_index } @named_printslip ),
    'patron_custom catch-all is ordered after all named printslip.pl types' );
